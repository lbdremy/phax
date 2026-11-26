// `phax finding fix <run> <id>… -- <path>…` (spec finding-ids-and-fates §5.11, §5.12, §5.19,
// §5.20): commits exactly the named paths in the run's final worktree while the run is
// review_open, then records each named finding `fixed` on `phax/records/v1`. With `--commit <sha>`
// it records an existing commit and makes none. Every refusal comes before any write. Once the
// records landed it reaches the run's pull request (`pullRequestAfterFates`): with `publish.auto`
// on and a pull request phax opened, it pushes the run branch (plain) and comments once per
// finding; otherwise nothing leaves the machine. The records branch is never pushed.
import { isAbsolute, relative, resolve } from "node:path";
import { Data, Effect, Result } from "effect";
import type { FindingFateEntry } from "../schemas/findingFateRecord.js";
import { runKey } from "../domain/runRef.js";
import type { RegistryCorruptionError } from "../domain/errors.js";
import { defaultFixSubject, fixCommitBody, splitFixOperands } from "../domain/findings/fixCall.js";
import { decideFollow, followSubject } from "../domain/findings/landed.js";
import { type PathClass } from "../schemas/pathClass.js";
import { classifyPath, pathClassesOf } from "../domain/findings/pathClass.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { GitHub } from "../ports/github.js";
import type { Terminal } from "../ports/terminal.js";
import type { CodeReviewFindingEntry, ComplianceFindingEntry } from "../schemas/findingList.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import {
  fateRecordDestination,
  type FindingRecordsOffError,
  type FindingRecordsUnavailableError,
  writeFateRecord,
} from "./findingFateRecords.js";
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
  type PullRequestOutcome,
  pullRequestAfterFates,
} from "./findingPullRequest.js";
import { baseBranchOf, followOnBase } from "./findingLanded.js";
import { resolveArbiter } from "./resolveArbiter.js";
import { gitFailureLine } from "./writeReviewRecord.js";

/** A refusal of the call, made before anything is written. */
class FindingFixRefusedError extends Data.TaggedError("FindingFixRefusedError")<{
  readonly message: string;
}> {}

/** Some fate records could not be written after the commit landed: the commit stays. */
export class FindingFateNotRecordedError extends Data.TaggedError("FindingFateNotRecordedError")<{
  readonly message: string;
  /** The commit that stays, or null when the call made none (dismiss, defer). */
  readonly commit: string | null;
  readonly recorded: readonly string[];
  readonly unrecorded: readonly string[];
  readonly retry: string;
}> {}

export interface FindingFixInput {
  /** The run as given on the command line. */
  readonly ref: string;
  /** Everything after the run reference: the ids, then the paths. */
  readonly operands: readonly string[];
  readonly commit: string | undefined;
  readonly subject: string | undefined;
  readonly body: string | undefined;
  readonly by: string | undefined;
  readonly cwd: string;
  readonly nowIso: string;
  readonly config: ResolvedConfig;
}

export interface FindingFixAnswer {
  readonly run: {
    readonly namespace: string;
    readonly shortName: string;
    readonly runId: string;
    readonly state: ResolvedFindingRun["state"];
  };
  readonly commit: {
    readonly sha: string;
    readonly made: boolean;
    readonly subject: string | null;
    readonly paths: readonly { readonly path: string; readonly pathClass: PathClass }[];
    /** How `--commit` was followed to `sha`, or null when the commit was recorded as named. */
    readonly followed: FollowedCommit | null;
  };
  readonly recorded: readonly {
    readonly finding: string;
    readonly key: string;
    readonly recordCommit: string;
  }[];
  readonly findings: readonly (CodeReviewFindingEntry | ComplianceFindingEntry)[];
  /** What reached the run's pull request, or why nothing did. */
  readonly pullRequest: PullRequestOutcome;
}

export type FindingFixError =
  | FindingFixRefusedError
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

const refuse = (message: string) => Effect.fail(new FindingFixRefusedError({ message }));

const gitLine = (error: GitError | FsError): string =>
  gitFailureLine("stderr" in error && error.stderr ? error.stderr : error.message);

/** A value `--commit` follows when it names no commit here: 4 to 40 hex characters. */
const SHA_SPELLING = /^[0-9a-f]{4,40}$/i;

/** Whether `sha` is, or is an ancestor of, the tip `ref`; false when `ref` does not resolve. */
function reachableFrom(repo: string, sha: string, ref: string) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const tip = yield* git.resolveRef(repo, ref);
    if (tip === null) return false;
    return (yield* git.mergeBase(repo, sha, tip)) === sha;
  });
}

/**
 * Whether the commit is on the run's final-phase branch (a live run whose branch resolves) or on
 * the base branch (`publish.baseBranch`, else `main`; the local branch, else the remote-tracking
 * one): null when it is, else the branches it is on neither of, as a refusal names them.
 */
function checkReachable(input: {
  readonly repo: string;
  readonly sha: string;
  readonly runBranch: string | null;
  /** Whether `repo` is the run's final worktree, whose HEAD is the run branch's tip. */
  readonly inWorktree: boolean;
  readonly config: ResolvedConfig;
}) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { repo, sha, config } = input;
    const checked: string[] = [];
    const named =
      input.runBranch !== null && (yield* git.resolveRef(repo, input.runBranch)) !== null
        ? input.runBranch
        : null;
    if (named !== null) {
      if (yield* reachableFrom(repo, sha, named)) return null;
      checked.push(named);
    } else if (input.inWorktree) {
      // The branch's name does not resolve here: the worktree's own HEAD is the run's tip.
      if (yield* reachableFrom(repo, sha, "HEAD")) return null;
      checked.push(input.runBranch ?? "the run branch");
    }
    const base = yield* baseBranchOf(repo, config);
    if (base.ref !== null && (yield* reachableFrom(repo, sha, base.ref))) return null;
    // A refusal names the local branch by its name, any other by its full remote-tracking ref.
    checked.push(
      base.ref?.startsWith("refs/heads/") === true
        ? base.label
        : `refs/remotes/${config.publish.remote}/${config.publish.baseBranch ?? "main"}`,
    );
    return checked;
  });
}

/** How `--commit` was followed to the commit recorded. */
interface FollowedCommit {
  /** The named commit's full sha when the repository holds it, else the value as given. */
  readonly named: string;
  /** The branches the named commit is on neither of, or null when the repository lacks it. */
  readonly notOn: readonly string[] | null;
  readonly by: "key" | "patch-id";
  /** The base branch's label, where the recorded commit was found. */
  readonly branch: string;
}

/**
 * The commit `--commit` records (spec §5.15, §5.16). A commit on the run branch or the base
 * branch is recorded as named. One on neither, or a sha-spelled value the repository does not
 * hold, is followed on the base branch by the findings' fate keys, then by its patch id, and the
 * one commit found for every finding is recorded; otherwise a refusal names every candidate.
 * Read-only: every refusal comes before any write.
 */
function commitToRecord(input: {
  readonly repo: string;
  readonly value: string;
  readonly run: ResolvedFindingRun;
  readonly ids: readonly string[];
  readonly inWorktree: boolean;
  readonly config: ResolvedConfig;
}) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { repo, value, run, config } = input;
    const resolved = yield* git.resolveRef(repo, `${value}^{commit}`);
    let notOn: readonly string[] | null = null;
    if (resolved !== null) {
      notOn = yield* checkReachable({
        repo,
        sha: resolved,
        runBranch: run.runBranch,
        inWorktree: input.inWorktree,
        config,
      });
      if (notOn === null) return { sha: resolved, followed: null };
    } else if (!SHA_SPELLING.test(value)) {
      return yield* refuse(`--commit ${value} names no commit in the run's repository`);
    }
    const named = resolved ?? value;
    const held = resolved !== null;
    const search = yield* followOnBase({
      repo,
      runId: run.runId,
      startedAt: run.startedAt,
      config,
      named,
      held,
      ids: input.ids,
    });
    const decision = decideFollow({
      subject: followSubject(named, notOn),
      base: search.baseBranch,
      runId: run.runId,
      held,
      matches: search.matches,
    });
    if (decision.kind === "refused") return yield* refuse(decision.message);
    const followed: FollowedCommit = { named, notOn, by: decision.by, branch: search.baseBranch };
    return { sha: decision.commit, followed };
  });
}

/** The worktree's repo-relative path for each named path, or a refusal for one that leaves it. */
function resolvePaths(input: {
  readonly worktree: string;
  readonly cwd: string;
  readonly paths: readonly string[];
}) {
  return Effect.gen(function* () {
    const git = yield* Git;
    const root = (yield* git.repoTopLevel(input.worktree)) ?? input.worktree;
    const here = yield* git.repoTopLevel(input.cwd);
    const base = here !== null && here === root ? input.cwd : root;
    const resolved: string[] = [];
    const outside: string[] = [];
    for (const path of input.paths) {
      const relation = relative(root, resolve(base, path));
      if (relation === ".." || relation.startsWith("../") || isAbsolute(relation)) {
        outside.push(path);
        continue;
      }
      resolved.push(relation === "" ? "." : relation.split("\\").join("/"));
    }
    if (outside.length > 0) {
      return yield* refuse(`${outside.join(", ")} leaves the worktree ${root}`);
    }
    return resolved;
  });
}

/** The run must be open for review with its final worktree for a call that makes a commit. */
function requireOpenRun(run: ResolvedFindingRun) {
  return Effect.gen(function* () {
    if (run.state !== "review_open") {
      return yield* refuse(
        `${run.shortName} is ${run.state}, not review_open: a fix rides the run while it is open for review`,
      );
    }
    const fs = yield* FileSystem;
    if (
      run.worktreePath === null ||
      !(yield* fs.exists(run.worktreePath).pipe(Effect.orElseSucceed(() => false)))
    ) {
      return yield* refuse(`${run.shortName} has no final worktree to commit in`);
    }
    return run.worktreePath;
  });
}

/**
 * Fixes the findings the call names. The path form commits the named paths in the run's final
 * worktree; `--commit` records an existing commit. Either way each finding gets one `fixed` fate
 * record, in the order named. A record that fails after the commit landed leaves the commit and
 * fails with `FindingFateNotRecordedError`, whose retry is the `--commit` form.
 */
export function fixFindings(
  input: FindingFixInput,
): Effect.Effect<FindingFixAnswer, FindingFixError, FileSystem | Git | GitHub | Terminal> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { config } = input;
    const { ids, paths } = splitFixOperands(input.operands);

    // 1. The call.
    if (ids.length === 0) {
      return yield* refuse("no finding named: give one or more finding ids (F2, C1) after the run");
    }
    const backfill = input.commit !== undefined;
    if (backfill && (paths.length > 0 || input.subject !== undefined || input.body !== undefined)) {
      return yield* refuse(
        "--commit records an existing commit and makes none: it takes no path, -m or --body",
      );
    }
    if (!backfill && paths.length === 0) {
      return yield* refuse("no path given: name the changed paths after --");
    }

    // 2. The run.
    const run = yield* resolveFindingRun(input.ref, config);
    const worktree = backfill ? run.worktreePath : yield* requireOpenRun(run);

    // 3. The records.
    const destination = yield* fateRecordDestination(run.target);
    if (run.target.kind === "unresolved") return yield* refuse(run.target.reason);
    const fs = yield* FileSystem;
    const inWorktree =
      worktree !== null && (yield* fs.exists(worktree).pipe(Effect.orElseSucceed(() => false)));
    const repo = inWorktree && worktree !== null ? worktree : run.target.repoRoot;

    // 4. Who fixes.
    const by = yield* resolveArbiter(input.by, repo).pipe(
      Effect.catchTag("ArtifactArbiterRefusedError", (error) => refuse(error.message)),
    );

    // 5. The findings.
    const before = yield* listRunFindings({ ref: input.ref, config });
    const known = new Set(before.document.findings.map((finding) => finding.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return yield* refuse(
        `${run.shortName} has no finding ${unknown.join(", ")}: \`phax finding list ${run.shortName}\` names its findings`,
      );
    }

    // 6 and 7. The commit.
    let sha: string;
    let subject: string | null;
    let followed: FollowedCommit | null = null;
    if (input.commit === undefined) {
      const named = yield* resolvePaths({ worktree: repo, cwd: input.cwd, paths });
      const unchanged: string[] = [];
      for (const [index, path] of named.entries()) {
        if ((yield* git.dirtyPaths(repo, [path])).length === 0) {
          unchanged.push(paths[index] ?? path);
        }
      }
      if (unchanged.length > 0) {
        return yield* refuse(unchanged.map((path) => `${path} has no change`).join(", "));
      }
      subject = input.subject ?? defaultFixSubject(ids, run.shortName);
      yield* git.commitPaths(
        repo,
        named,
        subject,
        fixCommitBody({ shortName: run.shortName, runId: run.runId, ids, body: input.body }),
      );
      sha = yield* git.headCommit(repo);
    } else {
      const chosen = yield* commitToRecord({
        repo,
        value: input.commit,
        run,
        ids,
        inWorktree,
        config,
      });
      sha = chosen.sha;
      followed = chosen.followed;
      subject = null;
    }

    // 8. Its paths and classes.
    const changed = yield* git.commitChangedPaths(repo, sha);
    if (changed.length === 0) {
      return yield* refuse(`commit ${sha.slice(0, 7)} changes no path: there is nothing to record`);
    }
    const pathClasses = pathClassesOf(changed);

    // 9. One record per id, in the order named.
    const entry: Extract<FindingFateEntry, { fate: "fixed" }> = {
      fate: "fixed",
      commit: sha,
      pathClasses,
      by,
      at: input.nowIso,
    };
    const recorded: { finding: string; key: string; recordCommit: string }[] = [];
    const unrecorded: string[] = [];
    let reason = "";
    for (const finding of ids) {
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
      const retry = `phax finding fix ${input.ref} ${unrecorded.join(" ")} --commit ${sha}`;
      const kept = input.commit === undefined ? `the commit ${sha.slice(0, 7)} stays` : "";
      const done =
        recorded.length === 0
          ? "none is recorded"
          : `recorded: ${recorded.map((r) => r.finding).join(", ")}`;
      return yield* Effect.fail(
        new FindingFateNotRecordedError({
          message: `✗ fix not recorded: ${unrecorded.join(", ")} of ${runKey(run.namespace, run.shortName)} could not be recorded on phax/records/v1 (${reason}); ${done}${kept === "" ? "" : `; ${kept}`}. Retry with: ${retry}`,
          commit: sha,
          recorded: recorded.map((r) => r.finding),
          unrecorded,
          retry,
        }),
      );
    }

    // 10. The named findings read again after the write, then the pull request.
    const after = yield* listRunFindings({ ref: input.ref, config });
    const named = ids.flatMap((id) =>
      after.document.findings.filter((finding) => finding.id === id),
    );
    const pullRequest = yield* pullRequestAfterFates({
      ref: input.ref,
      run,
      verb: "fix",
      findings: named,
      recorded: recorded.map((r) => r.finding),
      commit: input.commit === undefined ? sha : null,
      config,
    });
    return {
      run: {
        namespace: run.namespace,
        shortName: run.shortName,
        runId: run.runId,
        state: run.state,
      },
      commit: {
        sha,
        made: input.commit === undefined,
        subject,
        paths: changed.map((path) => ({ path, pathClass: classifyPath(path) })),
        followed,
      },
      recorded,
      findings: named,
      pullRequest,
    };
  });
}
