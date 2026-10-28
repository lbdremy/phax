import { Effect, Either, Layer } from "effect";
import { execFile as nodeExecFile } from "node:child_process";
import { GitHub, GitHubError } from "../ports/github.js";
import type { BranchName } from "../domain/branded.js";
import type { RepoVisibility, VisibilityReading } from "../domain/records/destination.js";
import { formatParseError } from "../schemas/formatError.js";
import { decodeGithubRepoView } from "../schemas/githubRepoView.js";

// A multi-line decode report on one line, for a GitHubError message.
function onOneLine(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("; ");
}

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
): Effect.Effect<
  { stdout: string; stderr: string; exitCode: number; message: string | null },
  never
> {
  return ghRun(args, cwd).pipe(
    Effect.map((r) => ({ ...r, exitCode: 0, message: null })),
    Effect.catchAll((err) =>
      Effect.succeed({
        stdout: "",
        stderr: err.stderr ?? "",
        exitCode: err.exitCode ?? 1,
        message: err.message,
      }),
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

  visibility: (repo) =>
    ghRunAllowFail(["repo", "view", "--json", "visibility", "-q", ".visibility"], repo).pipe(
      Effect.map(({ stdout, stderr, exitCode, message }): VisibilityReading => {
        if (exitCode !== 0) {
          // gh's own first non-empty stderr line; the spawn error's message
          // when gh could not run at all.
          const firstLine = stderr
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line !== "");
          return { visibility: "unknown", ghError: firstLine ?? message };
        }
        const value = stdout.trim().toUpperCase();
        const visibility: RepoVisibility =
          value === "PUBLIC" ? "public" : value === "PRIVATE" ? "private" : "unknown";
        return { visibility, ghError: null };
      }),
    ),

  defaultBaseBranch: (repo) =>
    ghRun(
      ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
      repo,
    ).pipe(Effect.map(({ stdout }) => stdout.trim())),

  repoWebUrl: (repo) => {
    const args = ["repo", "view", "--json", "url"] as const;
    const command = `gh ${args.join(" ")}`;
    const refuse = (message: string) => new GitHubError({ message, command, args: [...args] });
    return ghRun(args, repo).pipe(
      Effect.flatMap(({ stdout }) =>
        Effect.try({
          try: () => JSON.parse(stdout) as unknown,
          catch: () => refuse(`${command} did not answer JSON`),
        }),
      ),
      Effect.flatMap((parsed) =>
        decodeGithubRepoView(parsed).pipe(
          Either.match({
            onLeft: (err) =>
              Effect.fail(
                refuse(
                  `${command} answered an unexpected shape: ${onOneLine(formatParseError(err))}`,
                ),
              ),
            onRight: (view) => Effect.succeed(view.url),
          }),
        ),
      ),
    );
  },

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

  createIssue: ({ repo, title, bodyFile }) =>
    ghRun(["issue", "create", "--title", title, "--body-file", bodyFile], repo).pipe(
      Effect.map(({ stdout }) => stdout.trim()),
    ),

  createGist: ({ description, file, public: isPublic }) =>
    ghRun(
      isPublic
        ? ["gist", "create", file, "--description", description, "--public"]
        : ["gist", "create", file, "--description", description],
      process.cwd(),
    ).pipe(Effect.map(({ stdout }) => stdout.trim())),
});

export function makeNodeGitHubLayer(): Layer.Layer<GitHub> {
  return NodeGitHubLayer;
}
