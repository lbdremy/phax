// `phax finding post <run> <id>…` (spec finding-ids-and-fates §5.23, §5.24): posts, on the pull
// request the run's publication.json names, one comment per named finding naming its fate, after pushing
// the run branch when a named finding is fixed. It writes no record, so it is the retry when a
// fate command could not update the pull request, and it never records a fate twice. It ignores
// `publish.auto`: it is an explicit request to post. A call naming a fixed finding first asks
// GitHub the pull request's state: closed, it is refused; merged, it posts without pushing when
// every named fix is found on the base branch, and is refused otherwise, naming the `--commit`
// retry (spec finding-fix-identity §5.13, §5.14). Every refusal comes before any push or comment;
// only that state query precedes one.
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
  pullRequestStateBeforeFix,
  pushAndComment,
  readRunPullRequest,
} from "./findingPullRequest.js";

/** A refusal of the call, made before any push or comment. */
class FindingPostRefusedError extends Data.TaggedError("FindingPostRefusedError")<{
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
  /**
   * The pull request's state, as GitHub answered before a fixed comment reached it; null when
   * no fixed finding was named, so no state was asked.
   */
  readonly pullRequestState: "open" | "merged" | null;
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

const short = (sha: string) => sha.slice(0, 7);

/**
 * Why a fixed finding's comment cannot reach a merged pull request: its fix is not found on the
 * base branch `base` (spec finding-fix-identity §5.13). Null for a finding that is not fixed, or
 * whose fix is found on `base`.
 */
function notOnBase(finding: PrFinding, base: string, shortName: string): string | null {
  if (finding.fate !== "fixed") return null;
  const { landed } = finding;
  if (landed !== null && landed.status === "found" && landed.branch === base) return null;
  const latest = finding.history.at(-1);
  const recorded = landed?.recorded ?? (latest?.fate === "fixed" ? latest.commit : "");
  const head = `${finding.id} of ${shortName} is fixed by ${short(recorded)}`;
  if (landed === null) return `${head}, not found on ${base}`;
  if (landed.status === "found") return `${head}, found on ${landed.branch} but not on ${base}`;
  if (landed.status === "ambiguous") {
    return `${head}, and ${landed.commits.length} commits of ${landed.branch} match it: ${landed.commits.map(short).join(", ")}`;
  }
  const [first = base, second] = landed.branches;
  return second === undefined
    ? `${head}, not found on ${first}`
    : `${head}, found on neither ${first} nor ${second}`;
}

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
        `${run.shortName} has no recorded pull request (no publication.json with its URL in the run folder): nothing to post`,
      );
    }

    // 5. A fixed finding reaches an open pull request, or a merged one when its fix is found on
    // the base branch.
    const repoRoot = run.target.kind === "project" ? run.target.repoRoot : config.repoRoot;
    const fixed = findings.filter((finding) => finding.fate === "fixed").map((f) => f.id);
    let pullRequestState: FindingPostAnswer["pullRequestState"] = null;
    if (fixed.length > 0) {
      const state = yield* pullRequestStateBeforeFix({
        ref: input.ref,
        run,
        pullRequest,
        ids,
        recorded: [],
        commit: null,
        repoRoot,
      });
      if (state === "closed") {
        const others = findings.filter((finding) => finding.fate !== "fixed").map((f) => f.id);
        return yield* refuse(
          `${pullRequest} is ${state}: phax pushes nothing to it and posts no fixed comment on it (${fixed.join(", ")} ${fixed.length === 1 ? "is" : "are"} fixed); nothing was pushed or commented` +
            (others.length > 0 ? `. Name only ${others.join(", ")} to post the rest` : ""),
        );
      }
      if (state === "merged") {
        const base = listed.document.run.baseBranch;
        const clauses = findings.flatMap((finding) => {
          const clause = notOnBase(finding, base, run.shortName);
          return clause === null
            ? []
            : [
                `${clause}: nothing was commented. Record the commit that carries the fix with: phax finding fix ${input.ref} ${finding.id} --commit <sha>`,
              ];
        });
        // phax never fetches: a pull request merged on the forge reaches a local base branch only
        // once it is pulled, and until then no --commit names a commit of it either.
        if (clauses.length > 0) {
          return yield* refuse(
            `${clauses.join("; ")}. If the pull request was merged on the forge, update ${base} first (for example with git pull), then post again`,
          );
        }
      }
      pullRequestState = state;
    }

    // 6. and 7. Push when a finding is fixed and the pull request is open, then comment.
    const posted = yield* pushAndComment({
      ref: input.ref,
      run,
      pullRequest,
      findings,
      push: config.publish.pushBranch && pullRequestState === "open",
      remote: config.publish.remote,
      recorded: [],
      commit: null,
      repoRoot,
    });
    return {
      run: {
        namespace: run.namespace,
        shortName: run.shortName,
        runId: run.runId,
        state: run.state,
      },
      pullRequest: posted,
      pullRequestState,
      findings,
    };
  });
}
