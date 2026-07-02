import { Effect, Layer } from "effect";
import { execFile as nodeExecFile } from "node:child_process";
import { Git, GitError } from "../ports/git.js";
import type { BranchName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName } from "../domain/branded.js";
import { Either } from "effect";
import { isPortcelainClean, parseBranchOutput, parseBranchExistsOutput } from "../schemas/git.js";
import { parseNameStatus } from "../domain/reconciliation/parseNameStatus.js";

function gitRun(
  args: readonly string[],
  cwd: string,
): Effect.Effect<{ stdout: string; stderr: string }, GitError> {
  const command = `git ${args.join(" ")}`;
  return Effect.tryPromise({
    try: () =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        nodeExecFile("git", [...args], { cwd }, (err, stdout, stderr) => {
          if (err) {
            reject(Object.assign(err, { stdout: String(stdout), stderr: String(stderr) }));
          } else {
            resolve({ stdout: String(stdout), stderr: String(stderr) });
          }
        });
      }),
    catch: (err) => {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      const stderrStr = e.stderr !== undefined ? String(e.stderr) : undefined;
      const exitCode = typeof e.code === "number" ? e.code : undefined;
      return new GitError({
        message: e.message,
        command,
        ...(stderrStr !== undefined ? { stderr: stderrStr, stderrExcerpt: stderrStr } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
        args: [...args],
      });
    },
  });
}

function gitRunAllowFail(
  args: readonly string[],
  cwd: string,
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, never> {
  return Effect.sync(() => ({ stdout: "", stderr: "", exitCode: 0 })).pipe(
    Effect.flatMap(() =>
      gitRun(args, cwd).pipe(
        Effect.map((r) => ({ ...r, exitCode: 0 })),
        Effect.catchAll((err) =>
          Effect.succeed({ stdout: "", stderr: err.stderr ?? "", exitCode: err.exitCode ?? 1 }),
        ),
      ),
    ),
  );
}

export const NodeGitLayer = Layer.succeed(Git, {
  isClean: (repo) =>
    gitRun(["status", "--porcelain"], repo).pipe(
      Effect.map(({ stdout }) => isPortcelainClean(stdout)),
    ),

  currentBranch: (repo) =>
    gitRun(["rev-parse", "--abbrev-ref", "HEAD"], repo).pipe(
      Effect.flatMap(({ stdout }) => {
        const name = parseBranchOutput(stdout);
        const result = decodeBranchName(name);
        if (Either.isLeft(result)) {
          return Effect.fail(
            new GitError({
              message: `Could not parse branch name: "${name}"`,
              command: "git rev-parse --abbrev-ref HEAD",
            }),
          );
        }
        return Effect.succeed(result.right);
      }),
    ),

  createBranch: (branch, from, repo) =>
    gitRun(["branch", "--", branch, from], repo).pipe(Effect.asVoid),

  branchExists: (branch, repo) =>
    gitRunAllowFail(["rev-parse", "--verify", "--quiet", "--", branch], repo).pipe(
      Effect.map(({ stdout, exitCode }) => exitCode === 0 && parseBranchExistsOutput(stdout)),
    ),

  deleteBranch: (name, force, repo) =>
    gitRun(["branch", force ? "-D" : "-d", "--", name], repo).pipe(Effect.asVoid),

  addWorktree: (branch, path, repo) =>
    gitRun(["worktree", "add", "--", path, branch], repo).pipe(Effect.asVoid),

  removeWorktree: (path, force, repo) => {
    const args: string[] = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push("--", path);
    return gitRun(args, repo).pipe(Effect.asVoid);
  },

  // Stage everything then commit. `.gitignore` in the worktree excludes
  // `.phax-context/` (phax metadata), so this leaves handoff/summary out of
  // the commit while still capturing new and modified source files.
  commit: (repo, subject, body) =>
    gitRun(["add", "-A"], repo).pipe(
      Effect.flatMap(() => gitRun(["commit", "-m", subject, "-m", body], repo)),
      Effect.asVoid,
    ),

  worktreeIsClean: (path) =>
    gitRun(["status", "--porcelain"], path as string).pipe(
      Effect.map(({ stdout }) => isPortcelainClean(stdout)),
    ),

  pruneWorktrees: (repo) => gitRun(["worktree", "prune"], repo).pipe(Effect.asVoid),

  diffNameStatus: (path) =>
    gitRun(["diff", "--name-status", "HEAD^", "HEAD"], path as string).pipe(
      Effect.map(({ stdout }) => parseNameStatus(stdout)),
    ),

  remoteExists: (remote, repo) =>
    gitRunAllowFail(["remote", "get-url", remote], repo).pipe(
      Effect.map(({ exitCode }) => exitCode === 0),
    ),

  pushBranch: (branch, remote, repo) =>
    gitRun(["push", "--set-upstream", remote, "--", branch], repo).pipe(Effect.asVoid),
});

export function makeNodeGitLayer(): Layer.Layer<Git> {
  return NodeGitLayer;
}
