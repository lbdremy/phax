// `phax finding list <run>`: every finding of a run's reviews with its id and fate (spec
// finding-ids-and-fates §5.8). The run is named like `phax path` names one. A live run reads its
// run folder and the records of its own project; an archived run, which the resolver no longer
// finds under the state root, is resolved from its registry entry and read from
// `<archivePath>/runs` (`<stateRoot>/archive/<key>/runs` when the entry names no archive path).
// A finding's fate is that of its latest fate record (`findingFateRecords.ts`), its history every
// record oldest first. A git failure on the records branch is no failure: the records are `unavailable`. Local only:
// no fetch, no GitHub, no network.
import { Data, Effect, Result, Schema } from "effect";
import {
  findingFate,
  groupFateRecords,
  numberRunFindings,
  type RunFinding,
} from "../domain/findings/runFindings.js";
import type { FindingFateEntry } from "../schemas/findingFateRecord.js";
import { parseRunRef, runKey } from "../domain/runRef.js";
import type { RegistryCorruptionError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { Git } from "../ports/git.js";
import type {
  CodeReviewFindingEntry,
  ComplianceFindingEntry,
  FindingListDocument,
} from "../schemas/findingList.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { RunStateSchema } from "../schemas/status.js";
import { runFolderOf } from "./costBackfill.js";
import { readRunFateRecords } from "./findingFateRecords.js";
import { readRegistry } from "./registry.js";
import { resolveRunRef } from "./resolveRunRef.js";
import { reviewRecordTargetFor, runEndReviewRecordTarget } from "./reviewEntry.js";
import { readRunReviews, reviewSourceOf, type RunReviewSource } from "./runReviews.js";

/** The run reference was refused: the resolver's sentence. */
export class FindingRunRefError extends Data.TaggedError("FindingRunRefError")<{
  readonly message: string;
}> {}

/** A review document of the run could not be read: its name and why. */
export class FindingReviewUnreadableError extends Data.TaggedError("FindingReviewUnreadableError")<{
  readonly message: string;
}> {}

/** A fate record of the run could not be read: its name and why. */
export class FindingFateRecordUnreadableError extends Data.TaggedError(
  "FindingFateRecordUnreadableError",
)<{
  readonly message: string;
}> {}

/** What listing a run's findings answers. */
export interface FindingListResult {
  readonly document: FindingListDocument;
  /** Message lines for stderr: records off or unreadable, or an archive folder that is gone. */
  readonly notes: readonly string[];
}

export const RECORDS_OFF_NOTE =
  "records are off for this project: only the reviews in the run folder are listed";

/** The run as the list reads it: its identity, state, run folder and where its records are. */
interface ListedRun {
  readonly namespace: string;
  readonly shortName: string;
  readonly runId: string;
  readonly state: typeof RunStateSchema.Type;
  readonly runFolder: string | null;
  readonly source: RunReviewSource;
  /** Message lines the run itself owes: its archive folder is gone. */
  readonly notes: readonly string[];
}

const isRunState = Schema.is(RunStateSchema);

/** The run of an archived registry entry, or undefined when the registry holds none. */
function resolveArchivedRun(
  ref: string,
  config: ResolvedConfig,
): Effect.Effect<ListedRun | undefined, FsError | RegistryCorruptionError, FileSystem> {
  return Effect.gen(function* () {
    const parsed = parseRunRef(ref);
    if (Result.isFailure(parsed)) return undefined;
    const namespace = parsed.success.namespace ?? config.namespace;
    const { shortName } = parsed.success;
    const registry = yield* readRegistry(config.stateRoot);
    const entry = registry.runs.find(
      (run) => run.namespace === namespace && run.shortName === shortName,
    );
    if (entry === undefined || entry.state !== "archived") return undefined;
    const fs = yield* FileSystem;
    const folder = runFolderOf(config.stateRoot, entry);
    const present = yield* fs.exists(folder);
    const crossProject = namespace !== config.namespace;
    return {
      namespace,
      shortName,
      runId: entry.runId,
      state: "archived",
      runFolder: present ? folder : null,
      source: crossProject
        ? {
            kind: "unavailable",
            reason: `the run is archived and belongs to the project "${namespace}", whose records cannot be located from here`,
          }
        : reviewSourceOf(runEndReviewRecordTarget(config, namespace)),
      notes: present ? [] : [`the archive folder ${folder} is gone: only the records are listed`],
    } satisfies ListedRun;
  });
}

function resolveListedRun(
  ref: string,
  config: ResolvedConfig,
): Effect.Effect<ListedRun, FindingRunRefError | FsError | RegistryCorruptionError, FileSystem> {
  return Effect.gen(function* () {
    const resolved = resolveRunRef(ref, config, config.stateRoot);
    if (Result.isSuccess(resolved)) {
      const { namespace, shortName, info, crossProject } = resolved.success;
      if (!isRunState(info.runState)) {
        return yield* Effect.fail(
          new FindingRunRefError({
            message: `Run "${runKey(namespace, shortName)}" is in the unknown state "${info.runState}".`,
          }),
        );
      }
      return {
        namespace,
        shortName,
        runId: info.runId,
        state: info.runState,
        runFolder: info.runPath,
        source: reviewSourceOf(reviewRecordTargetFor({ config, namespace, info, crossProject })),
        notes: [],
      } satisfies ListedRun;
    }
    const archived = yield* resolveArchivedRun(ref, config);
    if (archived !== undefined) return archived;
    return yield* Effect.fail(new FindingRunRefError({ message: resolved.failure.message }));
  });
}

function entryOf(
  finding: RunFinding,
  history: readonly FindingFateEntry[],
): CodeReviewFindingEntry | ComplianceFindingEntry {
  const fate = findingFate(finding, history);
  if (finding.source === "code-review") {
    return {
      id: finding.id,
      source: "code-review",
      severity: finding.severity,
      file: finding.file,
      line: finding.line,
      message: finding.message,
      lens: finding.lens,
      escape: finding.escape,
      criterion: finding.criterion,
      suggestion: finding.suggestion,
      fate,
      history,
    };
  }
  return {
    id: finding.id,
    source: "compliance-review",
    severity: finding.severity,
    phaseId: finding.phaseId,
    dimension: finding.dimension,
    message: finding.message,
    fate,
    history,
  };
}

/**
 * Every finding of the run named by `ref`, numbered across its reviews (the records branch's
 * entries, then the unrecorded reviews kept in the run folder, then the run folder's file when it
 * differs from the newest record), with its fate and its fate history. Refused: a run that cannot
 * be resolved, and a review document or fate record that cannot be read. A records branch git cannot read is no
 * refusal: the answer says `records: "unavailable"` and a note says why.
 */
export function listRunFindings(input: {
  readonly ref: string;
  readonly config: ResolvedConfig;
}): Effect.Effect<
  FindingListResult,
  | FindingRunRefError
  | FindingReviewUnreadableError
  | FindingFateRecordUnreadableError
  | FsError
  | RegistryCorruptionError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const run = yield* resolveListedRun(input.ref, input.config);
    const read = yield* readRunReviews({
      runId: run.runId,
      runFolder: run.runFolder,
      source: run.source,
    });
    const first = read.unreadable[0];
    if (first !== undefined) {
      const named = first.message.includes(first.where)
        ? first.message
        : `${first.where}: ${first.message}`;
      return yield* Effect.fail(
        new FindingReviewUnreadableError({
          message: `Cannot list the findings of "${runKey(run.namespace, run.shortName)}": ${named}`,
        }),
      );
    }
    const fates = yield* readRunFateRecords({ runId: run.runId, source: run.source });
    const unreadableFate = fates.unreadable[0];
    if (unreadableFate !== undefined) {
      const named = unreadableFate.message.includes(unreadableFate.where)
        ? unreadableFate.message
        : `${unreadableFate.where}: ${unreadableFate.message}`;
      return yield* Effect.fail(
        new FindingFateRecordUnreadableError({
          message: `Cannot list the findings of "${runKey(run.namespace, run.shortName)}": ${named}`,
        }),
      );
    }
    const { findings } = numberRunFindings(read.reviews.map((item) => item.review));
    const { histories, orphans } = groupFateRecords(findings, fates.records);
    return {
      document: {
        run: {
          namespace: run.namespace,
          shortName: run.shortName,
          runId: run.runId,
          state: run.state,
        },
        records: read.records,
        findings: findings.map((finding) => entryOf(finding, histories.get(finding.id) ?? [])),
      },
      notes: [
        ...run.notes,
        ...(read.records === "off" ? [RECORDS_OFF_NOTE] : []),
        ...read.notes,
        ...fates.notes,
        ...orphans.map(
          (id) => `fate records name ${id}, which no review of the run holds: not listed`,
        ),
      ],
    };
  });
}
