// The pull-request side of a finding's fate (spec finding-ids-and-fates §5.22 to §5.25): which
// pull request a run has, and pushing the run branch then posting one comment per finding on it.
// `phax finding post` uses it alone; the fate commands reuse it once they settle a finding. The
// pull request is the one `publication.json` in the run folder names: phax asks GitHub nothing to
// find it, only, before a fixed finding reaches it, whether it is still open. Nothing here writes
// a fate record.
import { join } from "node:path";
import { Data, Effect, Result } from "effect";
import { decodeBranchName, decodeWorktreePath } from "../domain/branded.js";
import { renderFateComment } from "../domain/findings/fateComment.js";
import type { PrFinding } from "../domain/publish/prFindings.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { GitHub, type GitHubError, type PullRequestState } from "../ports/github.js";
import { decodePublication } from "../schemas/publication.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { ResolvedFindingRun } from "./findingList.js";
import { gitFailureLine } from "./writeReviewRecord.js";

/**
 * The push or a comment failed after the fates were recorded and, for a fix, the commit landed.
 * The commit and the records stay; `retry` posts what is left.
 */
export class FindingPullRequestNotUpdatedError extends Data.TaggedError(
  "FindingPullRequestNotUpdatedError",
)<{
  readonly message: string;
  readonly pullRequest: string;
  /** The commit that stays, or null when the call made none. */
  readonly commit: string | null;
  readonly recorded: readonly string[];
  readonly pushed: boolean;
  readonly posted: readonly { readonly finding: string; readonly url: string }[];
  readonly unposted: readonly string[];
  readonly retry: string;
}> {}

/** What reached the pull request: the push, when one was made, and each comment. */
export interface PullRequestPosted {
  readonly url: string;
  readonly pushed: {
    readonly remote: string;
    readonly branch: string;
    readonly sha: string;
  } | null;
  readonly comments: readonly { readonly finding: string; readonly url: string }[];
}

/**
 * The URL of the run's pull request: `pullRequestUrl` of `<runFolder>/publication.json` when its
 * `prStatus` is `created` (phax opened it) or `exists` (phax found it on the run branch, a pull
 * request opened by hand included). Null for no folder, no file, a file that does not
 * decode, or any other status.
 */
export function readRunPullRequest(
  runFolder: string | null,
): Effect.Effect<string | null, never, FileSystem> {
  return Effect.gen(function* () {
    if (runFolder === null) return null;
    const fs = yield* FileSystem;
    const text = yield* fs.readText(join(runFolder, "publication.json")).pipe(
      Effect.map((content): string | null => content),
      Effect.orElseSucceed((): string | null => null),
    );
    if (text === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    const decoded = decodePublication(json);
    if (Result.isFailure(decoded)) return null;
    const { prStatus, pullRequestUrl } = decoded.success;
    return (prStatus === "created" || prStatus === "exists") && pullRequestUrl !== undefined
      ? pullRequestUrl
      : null;
  });
}

const failureLine = (error: GitError | GitHubError | FsError): string =>
  gitFailureLine("stderr" in error && error.stderr ? error.stderr : error.message);

/** The run's final worktree when it is on disk, else null. */
function existingWorktree(
  run: ResolvedFindingRun,
): Effect.Effect<string | null, never, FileSystem> {
  return Effect.gen(function* () {
    if (run.worktreePath === null || run.worktreePath === "") return null;
    const fs = yield* FileSystem;
    const found = yield* fs.exists(run.worktreePath).pipe(Effect.orElseSucceed(() => false));
    return found ? run.worktreePath : null;
  });
}

export interface PushAndCommentInput {
  /** The run as given on the command line: the retry names it. */
  readonly ref: string;
  readonly run: ResolvedFindingRun;
  readonly pullRequest: string;
  /** The findings to post, in order, as `listRunFindings` reads them. */
  readonly findings: readonly PrFinding[];
  /** Push the run branch first (when the run has a branch and a final worktree). */
  readonly push: boolean;
  readonly remote: string;
  /** The ids whose fate this call recorded: the error names them. */
  readonly recorded: readonly string[];
  /** The commit this call made, or null. */
  readonly commit: string | null;
  /** Where gh runs when the run has no final worktree. */
  readonly repoRoot: string;
}

function notUpdated(input: {
  readonly ref: string;
  readonly pullRequest: string;
  readonly what: string;
  readonly recorded: readonly string[];
  readonly commit: string | null;
  readonly pushed: boolean;
  readonly posted: readonly { finding: string; url: string }[];
  readonly unposted: readonly string[];
  readonly hint: string | null;
}): FindingPullRequestNotUpdatedError {
  const retry = `phax finding post ${input.ref} ${input.unposted.join(" ")}`;
  const notes = [
    ...(input.recorded.length > 0
      ? [`the fates of ${input.recorded.join(", ")} are recorded`]
      : []),
    ...(input.commit === null ? [] : [`the commit ${input.commit.slice(0, 7)} stays`]),
    ...(input.hint === null ? [] : [input.hint]),
  ];
  return new FindingPullRequestNotUpdatedError({
    message:
      `✗ pull request not updated: ${input.pullRequest}: ${input.what}` +
      `${notes.length > 0 ? `; ${notes.join("; ")}` : ""}. Retry with: ${retry}`,
    pullRequest: input.pullRequest,
    commit: input.commit,
    recorded: input.recorded,
    pushed: input.pushed,
    posted: input.posted,
    unposted: input.unposted,
    retry,
  });
}

/**
 * Pushes the run branch to `remote` (plain, from the run's final worktree) when `push` is set and
 * the run has both, then posts one comment per finding, in order, from that worktree or else
 * `repoRoot`. A failed push posts nothing. A failed comment does not stop the others. Any failure
 * is a `FindingPullRequestNotUpdatedError` naming the ids left and the `phax finding post` retry.
 */
export function pushAndComment(
  input: PushAndCommentInput,
): Effect.Effect<PullRequestPosted, FindingPullRequestNotUpdatedError, FileSystem | Git | GitHub> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const github = yield* GitHub;
    const { run, pullRequest } = input;
    const ids = input.findings.map((finding) => finding.id);

    const worktree = yield* existingWorktree(run);
    const branch = run.runBranch === null ? null : decodeBranchName(run.runBranch);
    const worktreePath = worktree === null ? null : decodeWorktreePath(worktree);

    let pushed: PullRequestPosted["pushed"] = null;
    if (
      input.push &&
      branch !== null &&
      Result.isSuccess(branch) &&
      worktreePath !== null &&
      Result.isSuccess(worktreePath)
    ) {
      const branchName = branch.success;
      const cwd = worktreePath.success;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          yield* git.pushBranch(branchName, input.remote, cwd);
          return yield* git.headCommit(cwd);
        }),
      );
      if (Result.isFailure(attempt)) {
        return yield* Effect.fail(
          notUpdated({
            ref: input.ref,
            pullRequest,
            what: `could not push ${branchName} to ${input.remote} (${failureLine(attempt.failure)})`,
            recorded: input.recorded,
            commit: input.commit,
            pushed: false,
            posted: [],
            unposted: ids,
            hint: `if ${input.remote} has moved on, run \`git pull --no-rebase ${input.remote} ${branchName}\` in ${cwd} to bring its commits in without rewriting the fix`,
          }),
        );
      }
      pushed = { remote: input.remote, branch: branchName, sha: attempt.success };
    }

    const posted: { finding: string; url: string }[] = [];
    const unposted: string[] = [];
    let reason = "";
    for (const finding of input.findings) {
      const body = renderFateComment(finding);
      if (body === null) {
        unposted.push(finding.id);
        if (reason === "") reason = `${finding.id} has no fate record to post`;
        continue;
      }
      const result = yield* Effect.result(
        github.commentOnPullRequest({ pullRequest, body, repo: worktree ?? input.repoRoot }),
      );
      if (Result.isSuccess(result)) {
        posted.push({ finding: finding.id, url: result.success });
      } else {
        unposted.push(finding.id);
        if (reason === "") reason = failureLine(result.failure);
      }
    }
    if (unposted.length > 0) {
      return yield* Effect.fail(
        notUpdated({
          ref: input.ref,
          pullRequest,
          what: `could not comment ${unposted.join(", ")} (${reason})`,
          recorded: input.recorded,
          commit: input.commit,
          pushed: pushed !== null,
          posted,
          unposted,
          hint: null,
        }),
      );
    }
    return { url: pullRequest, pushed, comments: posted };
  });
}

/**
 * The state of the run's pull request, asked of GitHub before a fixed finding reaches it: a merged
 * or closed pull request gets neither the run branch nor a fixed comment, since the commit the
 * comment names is not in its base branch. gh runs from the run's final worktree, or else
 * `repoRoot`. A query that fails is a `FindingPullRequestNotUpdatedError`: nothing was pushed or
 * posted, and its retry is `phax finding post` for every id.
 */
export function pullRequestStateBeforeFix(input: {
  readonly ref: string;
  readonly run: ResolvedFindingRun;
  readonly pullRequest: string;
  /** The ids the call would post: the retry names them all. */
  readonly ids: readonly string[];
  readonly recorded: readonly string[];
  readonly commit: string | null;
  readonly repoRoot: string;
}): Effect.Effect<PullRequestState, FindingPullRequestNotUpdatedError, FileSystem | GitHub> {
  return Effect.gen(function* () {
    const github = yield* GitHub;
    const worktree = yield* existingWorktree(input.run);
    const state = yield* Effect.result(
      github.pullRequestState({
        pullRequest: input.pullRequest,
        repo: worktree ?? input.repoRoot,
      }),
    );
    if (Result.isSuccess(state)) return state.success;
    return yield* Effect.fail(
      notUpdated({
        ref: input.ref,
        pullRequest: input.pullRequest,
        what: `could not read its state (${failureLine(state.failure)})`,
        recorded: input.recorded,
        commit: input.commit,
        pushed: false,
        posted: [],
        unposted: [...input.ids],
        hint: "nothing was pushed or commented",
      }),
    );
  });
}

/** Why a fate command left the run's pull request alone. */
type PullRequestNotPostedReason =
  | "publish-auto-off"
  | "no-pull-request"
  | "push-branch-off"
  | "pull-request-merged"
  | "pull-request-closed";

/** What a fate command did to the run's pull request: nothing (and why), or the push and comments. */
export type PullRequestOutcome =
  | { readonly kind: "not-posted"; readonly reason: PullRequestNotPostedReason }
  | ({ readonly kind: "posted" } & PullRequestPosted);

/**
 * What a fate command does for the pull request once its records landed (§5.22, §5.23). With
 * `publish.auto` off, a run with no pull request in `publication.json`, or a fix while
 * `publish.pushBranch` is off, nothing leaves the machine. Otherwise `fix` asks GitHub the pull
 * request's state first: merged or closed, it pushes and posts nothing; open, it pushes the run
 * branch. Then each finding the call settled gets its comment, in order. `dismiss` and `defer`
 * push nothing and ask no state: their comments claim nothing about the code.
 */
export function pullRequestAfterFates(input: {
  readonly ref: string;
  readonly run: ResolvedFindingRun;
  readonly verb: "fix" | "dismiss" | "defer";
  /** The settled findings, as `listRunFindings` reads them after the write, in the order named. */
  readonly findings: readonly PrFinding[];
  readonly recorded: readonly string[];
  readonly commit: string | null;
  readonly config: ResolvedConfig;
}): Effect.Effect<
  PullRequestOutcome,
  FindingPullRequestNotUpdatedError,
  FileSystem | Git | GitHub
> {
  return Effect.gen(function* () {
    const { config, run } = input;
    if (!config.publish.auto) {
      return { kind: "not-posted", reason: "publish-auto-off" } as const;
    }
    const pullRequest = yield* readRunPullRequest(run.runFolder);
    if (pullRequest === null) return { kind: "not-posted", reason: "no-pull-request" } as const;
    if (input.verb === "fix" && !config.publish.pushBranch) {
      return { kind: "not-posted", reason: "push-branch-off" } as const;
    }
    const repoRoot = run.target.kind === "project" ? run.target.repoRoot : config.repoRoot;
    if (input.verb === "fix") {
      const state = yield* pullRequestStateBeforeFix({
        ref: input.ref,
        run,
        pullRequest,
        ids: input.findings.map((finding) => finding.id),
        recorded: input.recorded,
        commit: input.commit,
        repoRoot,
      });
      if (state === "merged") {
        return { kind: "not-posted", reason: "pull-request-merged" } as const;
      }
      if (state === "closed") {
        return { kind: "not-posted", reason: "pull-request-closed" } as const;
      }
    }
    const posted = yield* pushAndComment({
      ref: input.ref,
      run,
      pullRequest,
      findings: input.findings,
      push: input.verb === "fix",
      remote: config.publish.remote,
      recorded: input.recorded,
      commit: input.commit,
      repoRoot,
    });
    return { kind: "posted", ...posted } as const;
  });
}
