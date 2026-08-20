import { Effect, Layer } from "effect";
import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Git, GitError } from "../ports/git.js";
import { decodeBranchName } from "../domain/branded.js";
import { Either } from "effect";
import {
  isPortcelainClean,
  parseBranchOutput,
  parseBranchExistsOutput,
  parseHeadCommitOutput,
  parseChangedFilesOutput,
  parseDirtyPaths,
  parseLsTreeZ,
} from "../schemas/git.js";
import { parseNameStatus } from "../domain/reconciliation/parseNameStatus.js";

// Blob reads (`cat-file blob`) can return a full transcript, so a git run must
// not be capped at execFile's 1 MB default.
const MAX_BUFFER = 256 * 1024 * 1024;

interface GitRunOptions {
  /** Extra environment variables merged over `process.env` (e.g. GIT_INDEX_FILE). */
  readonly env?: Record<string, string>;
  /** Bytes written to the child's stdin (e.g. blob content for `hash-object`). */
  readonly input?: Uint8Array | string;
}

function toGitError(err: unknown, command: string, args: readonly string[]): GitError {
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
}

function runGitProcess(
  args: readonly string[],
  cwd: string,
  encoding: "utf8" | "buffer",
  opts: GitRunOptions,
): Promise<{ stdout: string | Buffer; stderr: string }> {
  const env = opts.env !== undefined ? { ...process.env, ...opts.env } : undefined;
  return new Promise((resolve, reject) => {
    const child = nodeExecFile(
      "git",
      [...args],
      { cwd, encoding, maxBuffer: MAX_BUFFER, ...(env !== undefined ? { env } : {}) },
      (err, stdout, stderr) => {
        const stderrStr = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr);
        if (err) {
          reject(Object.assign(err, { stdout, stderr: stderrStr }));
        } else {
          resolve({ stdout, stderr: stderrStr });
        }
      },
    );
    if (opts.input !== undefined && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

function gitRun(
  args: readonly string[],
  cwd: string,
  opts: GitRunOptions = {},
): Effect.Effect<{ stdout: string; stderr: string }, GitError> {
  const command = `git ${args.join(" ")}`;
  return Effect.tryPromise({
    try: () =>
      runGitProcess(args, cwd, "utf8", opts) as Promise<{ stdout: string; stderr: string }>,
    catch: (err) => toGitError(err, command, args),
  });
}

function gitRunBuffer(
  args: readonly string[],
  cwd: string,
  opts: GitRunOptions = {},
): Effect.Effect<{ stdout: Buffer; stderr: string }, GitError> {
  const command = `git ${args.join(" ")}`;
  return Effect.tryPromise({
    try: () =>
      runGitProcess(args, cwd, "buffer", opts) as Promise<{ stdout: Buffer; stderr: string }>,
    catch: (err) => toGitError(err, command, args),
  });
}

// Resolve a ref to its commit sha, or null when it does not exist. Shared by
// the `resolveRef` port method and the parent lookup in `writeTreeCommit`.
function resolveRefEffect(repo: string, ref: string): Effect.Effect<string | null, GitError> {
  return gitRunAllowFail(["rev-parse", "--verify", "--quiet", "--end-of-options", ref], repo).pipe(
    Effect.map(({ stdout, exitCode }) => (exitCode === 0 ? parseHeadCommitOutput(stdout) : null)),
  );
}

// Write `files` as one commit on `branch`, driving a throwaway index through
// GIT_INDEX_FILE so the repo's own index and working tree are never touched.
// hash-object stages blobs, update-index --index-info builds the scratch index,
// write-tree captures it, commit-tree parents onto the branch tip (orphan on the
// first write), and update-ref advances the branch — no add, checkout or stash.
function writeTreeCommitEffect(
  repo: string,
  branch: string,
  message: string,
  files: readonly { path: string; content: Uint8Array }[],
): Effect.Effect<string, GitError> {
  const ref = `refs/heads/${branch}`;
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "phax-records-index-")),
      catch: (err) =>
        new GitError({
          message: `Could not create scratch index directory: ${String(err)}`,
          command: "mkdtemp",
        }),
    }),
    (scratchDir) =>
      Effect.gen(function* () {
        const env = { GIT_INDEX_FILE: join(scratchDir, "index") };

        const lines: string[] = [];
        for (const file of files) {
          const { stdout } = yield* gitRun(["hash-object", "-w", "--stdin"], repo, {
            input: file.content,
          });
          lines.push(`100644 ${stdout.trim()}\t${file.path}`);
        }

        // Start from a guaranteed-empty scratch index, then load the entries.
        yield* gitRun(["read-tree", "--empty"], repo, { env });
        if (lines.length > 0) {
          yield* gitRun(["update-index", "--index-info"], repo, {
            env,
            input: `${lines.join("\n")}\n`,
          });
        }
        const { stdout: treeOut } = yield* gitRun(["write-tree"], repo, { env });
        const tree = treeOut.trim();

        const parent = yield* resolveRefEffect(repo, ref);
        const commitArgs =
          parent !== null
            ? ["commit-tree", tree, "-p", parent, "-m", message]
            : ["commit-tree", tree, "-m", message];
        const { stdout: commitOut } = yield* gitRun(commitArgs, repo);
        const commit = commitOut.trim();

        yield* gitRun(["update-ref", ref, commit], repo);
        return commit;
      }),
    (scratchDir) => Effect.promise(() => rm(scratchDir, { recursive: true, force: true })),
  );
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

  // No `--` here: for `git rev-parse`, `--` marks the start of pathspecs, so it
  // would make the branch be resolved as a file path and always fail --verify.
  // The BranchName schema (isSafeBranchName) already rejects leading-`-` inputs.
  branchExists: (branch, repo) =>
    gitRunAllowFail(["rev-parse", "--verify", "--quiet", branch], repo).pipe(
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

  dirtyPaths: (repo, paths) =>
    paths.length === 0
      ? Effect.succeed([])
      : gitRun(["-c", "core.quotePath=false", "status", "--porcelain", "--", ...paths], repo).pipe(
          Effect.map(({ stdout }) => parseDirtyPaths(stdout)),
        ),

  // Scoped to `paths` on both `add` and `commit` so other staged or dirty
  // files in the worktree never enter this commit.
  commitPaths: (repo, paths, subject, body) =>
    gitRun(["add", "-A", "--", ...paths], repo).pipe(
      Effect.flatMap(() => gitRun(["commit", "-m", subject, "-m", body, "--", ...paths], repo)),
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

  headCommit: (repo) =>
    gitRun(["rev-parse", "HEAD"], repo).pipe(
      Effect.flatMap(({ stdout }) => {
        const sha = parseHeadCommitOutput(stdout);
        if (sha === null) {
          return Effect.fail(
            new GitError({
              message: `Could not parse HEAD commit: "${stdout.trim()}"`,
              command: "git rev-parse HEAD",
            }),
          );
        }
        return Effect.succeed(sha);
      }),
    ),

  commitExists: (commit, repo) =>
    gitRunAllowFail(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], repo).pipe(
      Effect.map(({ exitCode }) => exitCode === 0),
    ),

  changedFilesSince: (baseline, repo) =>
    gitRun(["diff", "--name-only", baseline, "--"], repo).pipe(
      Effect.map(({ stdout }) => parseChangedFilesOutput(stdout)),
    ),

  writeTreeCommit: ({ repo, branch, message, files }) =>
    writeTreeCommitEffect(repo, branch, message, files),

  resolveRef: (repo, ref) => resolveRefEffect(repo, ref),

  readTree: (repo, treeish) =>
    gitRun(["ls-tree", "-r", "-z", treeish], repo).pipe(
      Effect.map(({ stdout }) => parseLsTreeZ(stdout)),
    ),

  readBlob: (repo, oid) =>
    gitRunBuffer(["cat-file", "blob", oid], repo).pipe(Effect.map(({ stdout }) => stdout)),
});

export function makeNodeGitLayer(): Layer.Layer<Git> {
  return NodeGitLayer;
}
