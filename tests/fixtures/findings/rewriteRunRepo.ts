import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findingGroup } from "../../../src/cli/definitions/finding.js";
import { boundedOutput, GIT_BOUND_MS } from "../../helpers/boundedSpawn.js";
import { runnerCall } from "../../helpers/runnerCall.js";
import { buildFateRunRepo, type FateRunRepo, head } from "./fateRunRepo.js";

// The run of fateRunRepo.ts and the history rewrites a fix commit lives through after review (spec
// finding-fix-identity): a merge commit, GitHub's Rebase and merge, a rebase of the run branch
// alone, a squash that keeps the messages or only a description, a commit on main before the run
// started, and the garbage collection that drops the old commits. Every git call runs in the
// fixture's own repository, with its own identity, through tests/helpers/boundedSpawn.ts. The
// fixture's run started at 2026-11-01T10:00:00.000Z (findingRunRepo.ts).

/** The run of `buildFateRunRepo()`, which these helpers rewrite. */
export type RewriteRunRepo = FateRunRepo;

/** Builds the run of `buildFateRunRepo()`; call `cleanup` after the test. */
export function buildRewriteRunRepo(): RewriteRunRepo {
  return buildFateRunRepo();
}

/** An instant before the run's start, for a commit that must stay out of every search range. */
export const BEFORE_RUN_START = "2026-10-01T10:00:00Z";

function git(args: readonly string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return boundedOutput("git", [...args], {
    boundMs: GIT_BOUND_MS,
    cwd,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
}

function write(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function sha(repo: RewriteRunRepo, ref: string): string {
  const resolved = head(repo, ref);
  if (resolved === null) throw new Error(`${ref} does not resolve`);
  return resolved;
}

/**
 * Writes `path` in the run's worktree and fixes `ids` with it through `phax finding fix --by
 * operator`, which commits it with the Finding-Run and Finding trailers and records each id.
 * Returns the fix commit.
 */
export async function fixInWorktree(
  repo: RewriteRunRepo,
  ids: readonly string[],
  path: string,
  content: string,
): Promise<string> {
  write(repo.worktreePath, path, content);
  const result = await runnerCall(
    [findingGroup],
    ["finding", "fix", repo.shortName, ...ids, "--by", "operator", "--", path],
  );
  if (result.code !== 0) throw new Error(`finding fix exited ${result.code}: ${result.err}`);
  return sha(repo, repo.runBranch);
}

/**
 * Commits `path` on the run branch with a plain message (no trailer), then records `ids` fixed by
 * it with `phax finding fix --commit`. Returns the commit.
 */
export async function fixByHandInWorktree(
  repo: RewriteRunRepo,
  ids: readonly string[],
  path: string,
  content: string,
): Promise<string> {
  write(repo.worktreePath, path, content);
  git(["add", "--", path], repo.worktreePath);
  git(["commit", "-q", "-m", "fix: by hand"], repo.worktreePath);
  const commit = sha(repo, repo.runBranch);
  const result = await runnerCall(
    [findingGroup],
    ["finding", "fix", repo.shortName, ...ids, "--commit", commit, "--by", "operator"],
  );
  if (result.code !== 0) throw new Error(`finding fix exited ${result.code}: ${result.err}`);
  return commit;
}

/**
 * Commits `path` on main, in the main checkout, with `message`; dated `date` (author and
 * committer) when given, now otherwise. Returns the commit.
 */
export function commitOnMain(
  repo: RewriteRunRepo,
  input: {
    readonly path: string;
    readonly content: string;
    readonly message: string;
    readonly date?: string;
  },
): string {
  write(repo.repoDir, input.path, input.content);
  git(["add", "--", input.path], repo.repoDir);
  git(
    ["commit", "-q", "-m", input.message],
    repo.repoDir,
    input.date === undefined
      ? undefined
      : { GIT_COMMITTER_DATE: input.date, GIT_AUTHOR_DATE: input.date },
  );
  return sha(repo, "main");
}

/** Merges the run branch into main with a merge commit, in the main checkout. Returns main. */
export function mergeRunBranch(repo: RewriteRunRepo): string {
  git(["merge", "-q", "--no-ff", "--no-edit", repo.runBranch], repo.repoDir);
  return sha(repo, "main");
}

/** Rebases the run branch onto main, in its worktree, recreating every commit. Returns its tip. */
export function rebaseRunBranch(repo: RewriteRunRepo): string {
  git(["rebase", "-q", "--force-rebase", "main"], repo.worktreePath);
  return sha(repo, repo.runBranch);
}

/** Removes the run's worktree and deletes its branch, as a merged pull request's cleanup does. */
export function deleteRunBranch(repo: RewriteRunRepo): void {
  git(["worktree", "remove", "--force", repo.worktreePath], repo.repoDir);
  git(["branch", "-q", "-D", repo.runBranch], repo.repoDir);
}

/**
 * GitHub's Rebase and merge: the run branch rebased onto main with every commit recreated, main
 * fast-forwarded to it, then the worktree removed and the branch deleted. Returns main.
 */
export function rebaseAndMerge(repo: RewriteRunRepo): string {
  const tip = rebaseRunBranch(repo);
  git(["merge", "-q", "--ff-only", tip], repo.repoDir);
  deleteRunBranch(repo);
  return sha(repo, "main");
}

/**
 * GitHub's Squash and merge, in the main checkout: one main commit holding every change of the
 * run branch. `messages` keeps each squashed commit's full message under a `* ` bullet, the way
 * GitHub writes them; `description` keeps only a title and a description. Returns main.
 */
export function squashMerge(repo: RewriteRunRepo, keep: "messages" | "description"): string {
  const squashed = git(
    ["log", "--reverse", "--format=%B%x00", `main..${repo.runBranch}`],
    repo.repoDir,
  )
    .split("\0")
    .map((message) => message.trim())
    .filter((message) => message !== "");
  const body =
    keep === "messages"
      ? squashed.map((message) => `* ${message}`).join("\n\n")
      : "Fixes the review's findings.";
  git(["merge", "-q", "--squash", repo.runBranch], repo.repoDir);
  git(["commit", "-q", "-m", `${repo.shortName} (#1)`, "-m", body], repo.repoDir);
  return sha(repo, "main");
}

/** Drops every commit no ref reaches: the reflogs expired, then an immediate prune. */
export function dropUnreachable(repo: RewriteRunRepo): void {
  git(["reflog", "expire", "--expire=now", "--all"], repo.repoDir);
  git(["gc", "-q", "--prune=now"], repo.repoDir);
}

/** Whether the repository holds `commit`. */
export function holds(repo: RewriteRunRepo, commit: string): boolean {
  return head(repo, `${commit}^{commit}`) !== null;
}

/** The commit's full message, as git stores it. */
export function messageOf(repo: RewriteRunRepo, commit: string): string {
  return git(["show", "-s", "--format=%B", commit], repo.repoDir);
}

/** Every ref and the object it names: `git for-each-ref`'s output. */
export function refs(repo: RewriteRunRepo): string {
  return git(["for-each-ref", "--format=%(refname) %(objectname)"], repo.repoDir);
}
