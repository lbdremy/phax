import { Effect, Either } from "effect";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import { REVIEW_RECORD_FILES, type ReviewRecordKind } from "../schemas/reviewRecord.js";
import type { FileSystem } from "../ports/fs.js";
import type { Git } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import { loadConfig, locateWorkingTree } from "./loadConfig.js";
import { pushRecordsBranch, recordsClonePath } from "./recordsSync.js";
import {
  reviewRecordPushWarning,
  reviewRecordWarning,
  writeReviewRecord,
  type ReviewRecordPush,
  type ReviewRecordStatus,
} from "./writeReviewRecord.js";

export interface ReviewRecordTarget {
  readonly kind: "project";
  readonly records: ResolvedRecordsConfig;
  readonly repoRoot: string;
  /** The local records clone, required for a dedicated `repo` destination. */
  readonly recordsClonePath?: string | undefined;
  /** Push the entry now (by hand), or `null` to leave it to publish's records push. */
  readonly push: { readonly publishRemote: string } | null;
}

/** The run's own project could not be read: no entry is written anywhere. */
export interface ReviewRecordUnresolved {
  readonly kind: "unresolved";
  readonly reason: string;
}

/** What became of a review's entry and of its push. */
export interface ReviewEntryOutcome {
  readonly record:
    | ReviewRecordStatus
    | { readonly kind: "no-entry" }
    | { readonly kind: "unresolved"; readonly reason: string };
  readonly push: ReviewRecordPush;
}

/** The outcome of a review that wrote no file of its own: nothing to record. */
export const NO_REVIEW_ENTRY: ReviewEntryOutcome = {
  record: { kind: "no-entry" },
  push: { kind: "no-record" },
};

/**
 * Keep a review's file as a `review` entry on the records branch of the run's
 * own project. A records concern never fails the review: the outcome reports
 * it for the caller to warn about.
 */
export function recordReviewEntry(input: {
  readonly target: ReviewRecordTarget | ReviewRecordUnresolved;
  readonly runId: string;
  readonly runPath: string;
  readonly review: ReviewRecordKind;
}): Effect.Effect<ReviewEntryOutcome, never, Git | FileSystem | GitHub> {
  return Effect.gen(function* () {
    const { target } = input;
    if (target.kind === "unresolved") {
      return {
        record: { kind: "unresolved", reason: target.reason },
        push: { kind: "no-record" },
      } satisfies ReviewEntryOutcome;
    }
    const record = yield* writeReviewRecord({
      repoRoot: target.repoRoot,
      recordsClonePath: target.recordsClonePath,
      records: target.records,
      runId: input.runId,
      runPath: input.runPath,
      review: input.review,
    });
    let push: ReviewRecordPush = { kind: "no-record" };
    if (record.kind === "written") {
      push =
        target.push === null
          ? { kind: "left-to-publish" }
          : yield* pushRecordsBranch({
              records: target.records,
              repoRoot: target.repoRoot,
              publishRemote: target.push.publishRemote,
              recordsClonePath: target.recordsClonePath,
            });
    }
    return { record, push } satisfies ReviewEntryOutcome;
  });
}

/**
 * The warnings an entry's outcome deserves, in the order an operator reads
 * them. `retryCommand` is the command that records a new review of this run.
 */
export function reviewEntryWarnings(
  outcome: ReviewEntryOutcome,
  review: ReviewRecordKind,
  retryCommand: string,
): readonly string[] {
  const warnings: string[] = [];
  if (outcome.record.kind === "unresolved") {
    warnings.push(
      `${review} entry not written: ${outcome.record.reason} — ${REVIEW_RECORD_FILES[review]} stays in the run folder; fix that, then rerun \`${retryCommand}\` to record a new review`,
    );
  } else if (outcome.record.kind !== "no-entry") {
    const warning = reviewRecordWarning(outcome.record, review, retryCommand);
    if (warning !== undefined) warnings.push(warning);
  }
  const pushWarning = reviewRecordPushWarning(outcome.push);
  if (pushWarning !== undefined) warnings.push(pushWarning);
  return warnings;
}

/** The line a written entry deserves (`Recorded: <key> (<sha8>)[, pushed to <remote>]`), or undefined. */
export function reviewEntryNotice(outcome: ReviewEntryOutcome): string | undefined {
  if (outcome.record.kind !== "written") return undefined;
  const pushed = outcome.push.kind === "pushed" ? `, pushed to ${outcome.push.remote}` : "";
  return `Recorded: ${outcome.record.key} (${outcome.record.commitSha.slice(0, 8)})${pushed}`;
}

/**
 * The target of the entry a run's end writes: the project's own records, no
 * push now (publish's records push carries the entry).
 */
export function runEndReviewRecordTarget(
  config: ResolvedConfig,
  namespace: string,
): ReviewRecordTarget {
  return {
    kind: "project",
    records: config.records,
    repoRoot: config.repoRoot,
    ...(config.records.destination.kind === "repo"
      ? { recordsClonePath: recordsClonePath(config.stateRoot, namespace) }
      : {}),
    push: null,
  };
}

/**
 * Where a by-hand review of a run is recorded: the records of the run's own
 * project, never the project the command runs from. A run of the current
 * project uses the current config; a run of another project (`crossProject`)
 * reads that project's config from the main checkout of the run's final
 * worktree. When that project cannot be read, no entry is written anywhere.
 */
export function reviewRecordTargetFor(input: {
  readonly config: ResolvedConfig;
  readonly namespace: string;
  readonly info: RunReviewInfo;
  readonly crossProject: boolean;
}): ReviewRecordTarget | ReviewRecordUnresolved {
  let project = input.config;
  if (input.crossProject) {
    const tree = locateWorkingTree(input.info.worktreePath);
    if (tree === undefined) {
      return {
        kind: "unresolved",
        reason: `the run's project could not be found: its worktree ${input.info.worktreePath} is not a git working tree`,
      };
    }
    const loaded = loadConfig(tree.mainRoot);
    if (Either.isLeft(loaded)) {
      return {
        kind: "unresolved",
        reason: `the run's project config at ${tree.mainRoot} could not be loaded (${loaded.left.message})`,
      };
    }
    if (loaded.right.namespace !== input.namespace) {
      return {
        kind: "unresolved",
        reason: `the project at ${tree.mainRoot} is "${loaded.right.namespace}", not the run's "${input.namespace}"`,
      };
    }
    project = loaded.right;
  }
  return {
    kind: "project",
    records: project.records,
    repoRoot: project.repoRoot,
    ...(project.records.destination.kind === "repo"
      ? { recordsClonePath: recordsClonePath(project.stateRoot, input.namespace) }
      : {}),
    push: { publishRemote: project.publish.remote },
  };
}
