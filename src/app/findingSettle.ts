// `phax finding dismiss <run> <id>… --why <reason>` and `phax finding defer <run> <id>… --to <path>
// --why <reason>` (spec finding-ids-and-fates §5.14 to §5.20): record each named finding dismissed
// or deferred on `phax/records/v1`, one record per id, in the order named. Only an operator settles
// a finding without fixing it. Every refusal comes before any write. Once the records landed each
// command comments on the run's pull request when `publish.auto` is on and phax opened one
// (`pullRequestAfterFates`); it pushes nothing, and the records branch is never pushed.
import { isAbsolute, relative, resolve } from "node:path";
import { Data, Effect, Result } from "effect";
import type { RegistryCorruptionError } from "../domain/errors.js";
import { isFindingId } from "../domain/findings/fixCall.js";
import { runKey } from "../domain/runRef.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { Terminal } from "../ports/terminal.js";
import type { FindingFateEntry } from "../schemas/findingFateRecord.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import {
  fateRecordDestination,
  type FindingRecordsOffError,
  type FindingRecordsUnavailableError,
  writeFateRecord,
} from "./findingFateRecords.js";
import { FindingFateNotRecordedError, type FindingFixAnswer } from "./findingFix.js";
import {
  type FindingFateRecordUnreadableError,
  listRunFindings,
  type FindingReviewUnreadableError,
  type FindingRunRefError,
  resolveFindingRun,
} from "./findingList.js";
import {
  type FindingPullRequestNotUpdatedError,
  pullRequestAfterFates,
} from "./findingPullRequest.js";
import { resolveArbiter } from "./resolveArbiter.js";
import { gitFailureLine } from "./writeReviewRecord.js";

/** A refusal of the call, made before anything is written. */
export class FindingSettleRefusedError extends Data.TaggedError("FindingSettleRefusedError")<{
  readonly message: string;
}> {}

export interface FindingSettleAnswer extends Omit<FindingFixAnswer, "commit"> {
  readonly commit: null;
}

export type FindingSettleError =
  | FindingSettleRefusedError
  | FindingFateNotRecordedError
  | FindingPullRequestNotUpdatedError
  | FindingRecordsOffError
  | FindingRecordsUnavailableError
  | FindingRunRefError
  | FindingReviewUnreadableError
  | FindingFateRecordUnreadableError
  | GitError
  | FsError
  | RegistryCorruptionError;

interface SettleInput {
  readonly ref: string;
  /** Everything after the run reference: the ids. */
  readonly operands: readonly string[];
  readonly why: string;
  readonly by: string | undefined;
  readonly nowIso: string;
  readonly config: ResolvedConfig;
}

export type DismissInput = SettleInput;
export interface DeferInput extends SettleInput {
  readonly to: string;
  readonly cwd: string;
}

const refuse = (message: string) => Effect.fail(new FindingSettleRefusedError({ message }));

const gitLine = (error: GitError | FsError): string =>
  gitFailureLine("stderr" in error && error.stderr ? error.stderr : error.message);

type Verb = "dismiss" | "defer";

function settle(
  verb: Verb,
  input: SettleInput & { readonly cwd?: string; readonly to?: string },
): Effect.Effect<FindingSettleAnswer, FindingSettleError, FileSystem | Git | GitHub | Terminal> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { config } = input;

    // 1. Only an operator.
    if (input.by?.startsWith("machine:") === true) {
      return yield* refuse(
        verb === "dismiss"
          ? "only an operator dismisses a finding"
          : "only an operator defers a finding",
      );
    }

    // 2. The ids.
    const bad = input.operands.filter((operand) => !isFindingId(operand));
    if (bad.length > 0) {
      return yield* refuse(`${bad.join(", ")} is not a finding id (F2, C1)`);
    }
    const ids = [...new Set(input.operands)];
    if (ids.length === 0) {
      return yield* refuse("no finding named: give one or more finding ids (F2, C1) after the run");
    }

    // 3. The run, 4. the records.
    const run = yield* resolveFindingRun(input.ref, config);
    const destination = yield* fateRecordDestination(run.target);
    if (run.target.kind === "unresolved") return yield* refuse(run.target.reason);

    // 5. Who.
    const by = yield* resolveArbiter(input.by, run.target.repoRoot).pipe(
      Effect.catchTag("ArtifactArbiterRefusedError", (error) => refuse(error.message)),
    );
    if (by.kind !== "operator") {
      return yield* refuse(
        verb === "dismiss"
          ? "only an operator dismisses a finding"
          : "only an operator defers a finding",
      );
    }

    // 6. The findings.
    const before = yield* listRunFindings({ ref: input.ref, config });
    const byId = new Map(before.document.findings.map((finding) => [finding.id, finding]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return yield* refuse(
        `${run.shortName} has no finding ${unknown.join(", ")}: \`phax finding list ${run.shortName}\` names its findings`,
      );
    }

    // 7. The pointer (defer only).
    let pointer = "";
    if (verb === "defer") {
      const given = input.to ?? "";
      const checkout = yield* git.repoTopLevel(input.cwd ?? run.target.repoRoot);
      if (checkout === null) {
        return yield* refuse(`${given} is not a tracked file`);
      }
      const rel = relative(checkout, resolve(input.cwd ?? checkout, given));
      const inside = rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
      const path = rel.split("\\").join("/");
      const tree = inside ? yield* git.readTree(checkout, "HEAD") : [];
      if (!inside || !tree.some((entry) => entry.type === "blob" && entry.path === path)) {
        return yield* refuse(`${given} is not a tracked file`);
      }
      pointer = path;
    }

    // Records, one per id, in the order named.
    const recorded: { finding: string; key: string; recordCommit: string }[] = [];
    const unrecorded: string[] = [];
    let reason = "";
    for (const finding of ids) {
      const found = byId.get(finding);
      const advocate =
        found?.source === "code-review"
          ? found.suggestion
          : found !== undefined && found.message.trim() !== ""
            ? found.message
            : `fix ${finding}`;
      const entry: FindingFateEntry =
        verb === "dismiss"
          ? {
              fate: "dismissed",
              verdict: {
                kind: "decided",
                chosen: "dismiss",
                abandoned: ["fix", "defer"],
                why: input.why,
                advocate,
                principles: [],
                reversibility: "cheap",
                by,
                at: input.nowIso,
                revised: [],
              },
            }
          : { fate: "deferred", to: pointer, why: input.why, by, at: input.nowIso };
      const written = yield* Effect.result(
        writeFateRecord({ destination, runId: run.runId, finding, entry }),
      );
      if (Result.isSuccess(written)) {
        recorded.push({ finding, ...written.success });
      } else {
        unrecorded.push(finding);
        if (reason === "") reason = gitLine(written.failure);
      }
    }
    if (unrecorded.length > 0) {
      const done =
        recorded.length === 0
          ? "none is recorded"
          : `recorded: ${recorded.map((r) => r.finding).join(", ")}`;
      return yield* Effect.fail(
        new FindingFateNotRecordedError({
          message: `✗ ${verb} not recorded: ${unrecorded.join(", ")} of ${runKey(run.namespace, run.shortName)} could not be recorded on phax/records/v1 (${reason}); ${done}. Running the same command again for ${unrecorded.join(", ")} records ${unrecorded.length === 1 ? "it" : "them"}`,
          commit: null,
          recorded: recorded.map((r) => r.finding),
          unrecorded,
          retry: `phax finding ${verb} ${input.ref} ${unrecorded.join(" ")}`,
        }),
      );
    }

    const after = yield* listRunFindings({ ref: input.ref, config });
    const named = ids.flatMap((id) =>
      after.document.findings.filter((finding) => finding.id === id),
    );
    const pullRequest = yield* pullRequestAfterFates({
      ref: input.ref,
      run,
      verb,
      findings: named,
      recorded: recorded.map((r) => r.finding),
      commit: null,
      config,
    });
    return {
      run: {
        namespace: run.namespace,
        shortName: run.shortName,
        runId: run.runId,
        state: run.state,
      },
      commit: null,
      recorded,
      findings: named,
      pullRequest,
    };
  });
}

/** Dismisses the findings the call names, one record per id. */
export const dismissFindings = (input: DismissInput) => settle("dismiss", input);

/** Defers the findings the call names to a tracked file, one record per id. */
export const deferFindings = (input: DeferInput) => settle("defer", input);
