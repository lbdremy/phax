import { Effect, Layer } from "effect";
import { execFile as nodeExecFile } from "node:child_process";
import { GitHub, GitHubError } from "../ports/github.js";
import type { BranchName } from "../domain/branded.js";

function ghRun(
  args: readonly string[],
  cwd: string,
): Effect.Effect<{ stdout: string; stderr: string }, GitHubError> {
  const command = `gh ${args.join(" ")}`;
  return Effect.tryPromise({
    try: () =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        nodeExecFile("gh", [...args], { cwd }, (err, stdout, stderr) => {
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
      return new GitHubError({
        message: e.message,
        command,
        ...(stderrStr !== undefined ? { stderr: stderrStr } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
        args: [...args],
      });
    },
  });
}

function ghRunAllowFail(
  args: readonly string[],
  cwd: string,
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, never> {
  return Effect.sync(() => ({ stdout: "", stderr: "", exitCode: 0 })).pipe(
    Effect.flatMap(() =>
      ghRun(args, cwd).pipe(
        Effect.map((r) => ({ ...r, exitCode: 0 })),
        Effect.catchAll((err) =>
          Effect.succeed({ stdout: "", stderr: err.stderr ?? "", exitCode: err.exitCode ?? 1 }),
        ),
      ),
    ),
  );
}

export const NodeGitHubLayer = Layer.succeed(GitHub, {
  isAvailable: () =>
    ghRunAllowFail(["--version"], process.cwd()).pipe(Effect.map(({ exitCode }) => exitCode === 0)),

  isAuthenticated: (repo) =>
    ghRunAllowFail(["auth", "status"], repo).pipe(Effect.map(({ exitCode }) => exitCode === 0)),

  repoRecognized: (repo) =>
    ghRunAllowFail(["repo", "view"], repo).pipe(Effect.map(({ exitCode }) => exitCode === 0)),

  defaultBaseBranch: (repo) =>
    ghRun(
      ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
      repo,
    ).pipe(Effect.map(({ stdout }) => stdout.trim())),

  findPullRequestForBranch: (branch: BranchName, repo: string) =>
    ghRun(
      ["pr", "list", "--head", branch, "--state", "all", "--json", "url", "-q", ".[0].url"],
      repo,
    ).pipe(
      Effect.map(({ stdout }) => {
        const trimmed = stdout.trim();
        return trimmed.length > 0 ? trimmed : null;
      }),
      Effect.catchAll(() => Effect.succeed(null)),
    ),

  createPullRequest: ({ branch, base, title, bodyFile, repo }) =>
    ghRun(
      ["pr", "create", "--head", branch, "--base", base, "--title", title, "--body-file", bodyFile],
      repo,
    ).pipe(Effect.map(({ stdout }) => stdout.trim())),
});

export function makeNodeGitHubLayer(): Layer.Layer<GitHub> {
  return NodeGitHubLayer;
}
