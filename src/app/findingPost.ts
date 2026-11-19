// `phax finding post <run> <id>…` (spec finding-ids-and-fates §5.23, §5.24): posts, on the pull
// request phax opened for the run, one comment per named finding naming its fate, after pushing
// the run branch when a named finding is fixed. It writes no record, so it is the retry when a
// fate command could not update the pull request, and it never records a fate twice. It ignores
// `publish.auto`: it is an explicit request to post. Every refusal comes before any push or call.
import { Data, Effect } from "effect";
import type { RegistryCorruptionError } from "../domain/errors.js";
import { isFindingId } from "../domain/findings/fixCall.js";
import type { FileSystem, FsError } from "../ports/fs.js";
import type { Git, GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { PrFinding } from "../domain/publish/prFindings.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import {
  type FindingFateRecordUnreadableError,
  listRunFindings,
  type FindingReviewUnreadableError,
  type FindingRunRefError,
  resolveFindingRun,
  type ResolvedFindingRun,
} from "./findingList.js";
import {
  type FindingPullRequestNotUpdatedError,
  type PullRequestPosted,
  pushAndComment,
  readRunPullRequest,
} from "./findingPullRequest.js";

/** A refusal of the call, made before any push or GitHub call. */
export class FindingPostRefusedError extends Data.TaggedError("FindingPostRefusedError")<{
  readonly message: string;
}> {}

export interface FindingPostAnswer {
  readonly run: {
    readonly namespace: string;
    readonly shortName: string;
    readonly runId: string;
    readonly state: ResolvedFindingRun["state"];
  };
  readonly pullRequest: PullRequestPosted;
  /** The named findings, in the order named. */
  readonly findings: readonly PrFinding[];
}

export type FindingPostError =
  | FindingPostRefusedError
  | FindingPullRequestNotUpdatedError
  | FindingRunRefError
  | FindingReviewUnreadableError
  | FindingFateRecordUnreadableError
  | GitError
  | FsError
  | RegistryCorruptionError;

const refuse = (message: string) => Effect.fail(new FindingPostRefusedError({ message }));

/** Posts the comments of the findings the call names, already settled, on the run's pull request. */
export function postFindings(input: {
  readonly ref: string;
  readonly operands: readonly string[];
  readonly config: ResolvedConfig;
}): Effect.Effect<FindingPostAnswer, FindingPostError, FileSystem | Git | GitHub> {
  return Effect.gen(function* () {
    const { config } = input;

    // 1. The ids.
    const bad = input.operands.filter((operand) => !isFindingId(operand));
    if (bad.length > 0) {
      return yield* refuse(`${bad.join(", ")} is not a finding id (F2, C1)`);
    }
    const ids = [...new Set(input.operands)];
    if (ids.length === 0) {
      return yield* refuse("no finding named: give one or more finding ids (F2, C1) after the run");
    }

    // 2. The run, 3. its findings.
    const run = yield* resolveFindingRun(input.ref, config);
    const listed = yield* listRunFindings({ ref: input.ref, config });
    const byId = new Map(listed.document.findings.map((finding) => [finding.id, finding]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return yield* refuse(
        `${run.shortName} has no finding ${unknown.join(", ")}: \`phax finding list ${run.shortName}\` names its findings`,
      );
    }
    const findings = ids.flatMap((id) => {
      const found = byId.get(id);
      return found === undefined ? [] : [found];
    });
    for (const finding of findings) {
      if (finding.fate === "open" || finding.fate === "unrecorded") {
        return yield* refuse(`${finding.id} is ${finding.fate}: it has no fate to post`);
      }
    }

    // 4. The pull request.
    const pullRequest = yield* readRunPullRequest(run.runFolder);
    if (pullRequest === null) {
      return yield* refuse(
        `${run.shortName} has no pull request phax opened (no publication.json with its URL in the run folder): nothing to post`,
      );
    }

    // 5. and 6. Push when a finding is fixed, then comment.
    const posted = yield* pushAndComment({
      ref: input.ref,
      run,
      pullRequest,
      findings,
      push: config.publish.pushBranch && findings.some((finding) => finding.fate === "fixed"),
      remote: config.publish.remote,
      recorded: [],
      commit: null,
      repoRoot: run.target.kind === "project" ? run.target.repoRoot : config.repoRoot,
    });
    return {
      run: {
        namespace: run.namespace,
        shortName: run.shortName,
        runId: run.runId,
        state: run.state,
      },
      pullRequest: posted,
      findings,
    };
  });
}
