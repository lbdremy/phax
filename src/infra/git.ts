import { Effect, Layer } from "effect";
import { execFile as nodeExecFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdtemp, readlink, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { Git, GitError, type GitTreeEntry } from "../ports/git.js";
import type {
  ObservedEntry,
  ProtectedObservation,
  TrackedState,
} from "../domain/security/protectedPaths.js";
import type { ChangedPath } from "../domain/interactive/worktreeChange.js";
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
  parseRefList,
  parseRevListCount,
  parseWorktreeListPorcelain,
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

// A temporary index file for `use`, in its own temporary directory that is
// removed afterwards whatever the outcome. Every git run inside `use` that
// passes the returned env reads and writes that index, never the real one.
function withTempIndex<A>(
  prefix: string,
  use: (env: Record<string, string>) => Effect.Effect<A, GitError>,
): Effect.Effect<A, GitError> {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), prefix)),
      catch: (err) =>
        new GitError({
          message: `Could not create a temporary index directory: ${String(err)}`,
          command: "mkdtemp",
        }),
    }),
    (dir) => use({ GIT_INDEX_FILE: join(dir, "index") }),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
}

const PHAX_CONTEXT_DIR = ".phax-context";

function parseTreeId(stdout: string, command: string): Effect.Effect<string, GitError> {
  const tree = stdout.trim();
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(tree)
    ? Effect.succeed(tree)
    : Effect.fail(new GitError({ message: `Could not parse a tree id: "${tree}"`, command }));
}

// A row of `git diff-tree -M`: one file renamed, both paths kept.
interface RenamedPath {
  readonly status: "R";
  readonly oldPath: string;
  readonly path: string;
}

// `git diff-tree -r -z --name-status` prints `<status>\0<path>\0` per entry.
// Without rename or copy detection, a status is one of A, M, D or T; any other
// is refused rather than guessed at. With `renames`, an `R<score>` status is
// followed by two paths, the old then the new, and gives a RenamedPath; every
// other status reads as without. Paths are kept as written.
function parseDiffTreeNameStatusZ(
  stdout: string,
  command: string,
  renames: false,
): Effect.Effect<readonly ChangedPath[], GitError>;
function parseDiffTreeNameStatusZ(
  stdout: string,
  command: string,
  renames: true,
): Effect.Effect<readonly (ChangedPath | RenamedPath)[], GitError>;
function parseDiffTreeNameStatusZ(
  stdout: string,
  command: string,
  renames: boolean,
): Effect.Effect<readonly (ChangedPath | RenamedPath)[], GitError> {
  const fields = stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const truncated = Effect.fail(new GitError({ message: "Truncated diff-tree output", command }));
  const entries: (ChangedPath | RenamedPath)[] = [];
  let i = 0;
  while (i < fields.length) {
    const status = fields[i]!;
    const path = fields[i + 1];
    if (path === undefined) return truncated;
    if (renames && /^R\d*$/.test(status)) {
      const newPath = fields[i + 2];
      if (newPath === undefined) return truncated;
      entries.push({ status: "R", oldPath: path, path: newPath });
      i += 3;
      continue;
    }
    if (status !== "A" && status !== "M" && status !== "D" && status !== "T") {
      return Effect.fail(
        new GitError({ message: `Unexpected diff-tree status "${status}" for ${path}`, command }),
      );
    }
    entries.push({ status, path });
    i += 2;
  }
  return Effect.succeed(entries);
}

function isInsidePhaxContext(path: string): boolean {
  return path === PHAX_CONTEXT_DIR || path.startsWith(`${PHAX_CONTEXT_DIR}/`);
}

// Delete a path the restored tree does not hold, then each parent directory
// it leaves empty, up to (never including) the worktree root. A path that
// would leave the worktree is refused.
function deleteFromWorktree(worktree: string, path: string): Effect.Effect<void, GitError> {
  const root = resolvePath(worktree);
  const target = resolvePath(root, path);
  if (!target.startsWith(`${root}${sep}`)) {
    return Effect.fail(
      new GitError({ message: `Refusing to delete ${path}: outside the worktree`, command: "rm" }),
    );
  }
  return Effect.tryPromise({
    try: async () => {
      await rm(target, { force: true });
      for (let dir = dirname(target); dir !== root && dir.startsWith(root); dir = dirname(dir)) {
        try {
          await rmdir(dir);
        } catch {
          break;
        }
      }
    },
    catch: (err) =>
      new GitError({ message: `Could not delete ${path}: ${String(err)}`, command: "rm" }),
  });
}

function snapshotWorktreeEffect(
  worktree: string,
  extraEnv: Record<string, string> = {},
): Effect.Effect<string, GitError> {
  return withTempIndex("phax-snapshot-index-", (indexEnv) =>
    Effect.gen(function* () {
      const env = { ...indexEnv, ...extraEnv };
      // Seeded from HEAD so a tracked file matching an ignore pattern keeps
      // its entry; `add -A` then records every change. `.phax-context/` is
      // put back to HEAD's entries afterwards rather than excluded by a
      // pathspec: `add` exits 1 on an exclude naming an ignored directory,
      // which `.phax-context/` is in every phase worktree.
      yield* gitRun(["read-tree", "HEAD"], worktree, { env });
      yield* gitRun(["add", "-A", "--", "."], worktree, { env });
      yield* gitRun(["reset", "-q", "HEAD", "--", PHAX_CONTEXT_DIR], worktree, { env });
      const { stdout } = yield* gitRun(["write-tree"], worktree, { env });
      return yield* parseTreeId(stdout, "git write-tree");
    }),
  );
}

function restorePathsEffect(
  worktree: string,
  tree: string,
  paths: readonly string[],
): Effect.Effect<void, GitError> {
  const wanted = [...new Set(paths)].filter((p) => !isInsidePhaxContext(p));
  if (wanted.length === 0) return Effect.void;
  return withTempIndex("phax-restore-index-", (indexEnv) =>
    Effect.gen(function* () {
      // Literal pathspecs: a path holding `*` or `:` names that file only.
      const env = { ...indexEnv, GIT_LITERAL_PATHSPECS: "1" };
      yield* gitRun(["read-tree", tree], worktree, { env });
      const { stdout } = yield* gitRun(["ls-files", "-z", "--cached", "--", ...wanted], worktree, {
        env,
      });
      const inTree = new Set(stdout.split("\0").filter((p) => p.length > 0));
      // Deletions first, so a directory a turn put where a file was is gone
      // before that file is checked out again.
      for (const path of wanted.filter((p) => !inTree.has(p))) {
        yield* deleteFromWorktree(worktree, path);
      }
      const present = wanted.filter((p) => inTree.has(p));
      if (present.length > 0) {
        yield* gitRun(["checkout-index", "-f", "--", ...present], worktree, { env });
      }
    }),
  );
}

// The tree is read into a temporary index and committed with `git commit`, so
// the hooks see exactly that tree staged (GIT_INDEX_FILE reaches them too) and
// signing applies. The real index is reset to the new HEAD only once the
// committed tree is known to be `tree`.
function commitTreeEffect(
  worktree: string,
  tree: string,
  subject: string,
  body: string,
): Effect.Effect<string, GitError> {
  return Effect.gen(function* () {
    const oldHead = yield* resolveRefEffect(worktree, "HEAD");
    if (oldHead === null) {
      return yield* Effect.fail(
        new GitError({
          message: `${worktree}: HEAD names no commit`,
          command: "git rev-parse HEAD",
        }),
      );
    }
    const newHead = yield* withTempIndex("phax-commit-index-", (env) =>
      Effect.gen(function* () {
        yield* gitRun(["read-tree", tree], worktree, { env });
        yield* gitRun(["commit", "--allow-empty", "-m", subject, "-m", body], worktree, { env });
        const head = yield* resolveRefEffect(worktree, "HEAD");
        if (head === null || head === oldHead) {
          return yield* Effect.fail(
            new GitError({ message: "git commit left HEAD where it was", command: "git commit" }),
          );
        }
        return head;
      }),
    );
    const { stdout } = yield* gitRun(["rev-parse", "--verify", `${newHead}^{tree}`], worktree);
    const committed = yield* parseTreeId(stdout, `git rev-parse ${newHead}^{tree}`);
    if (committed !== tree) {
      const { stdout: names } = yield* gitRun(
        ["diff-tree", "-r", "-z", "--name-only", "--no-renames", tree, committed],
        worktree,
      );
      const paths = names.split("\0").filter((p) => p.length > 0);
      yield* gitRun(["update-ref", "HEAD", oldHead, newHead], worktree);
      return yield* Effect.fail(
        new GitError({
          message: `A commit hook changed the committed tree (${paths.join(", ") || "no path listed"}); the commit was undone`,
          command: "git commit",
        }),
      );
    }
    yield* gitRun(["read-tree", "HEAD"], worktree);
    return newHead;
  });
}

// Rename both sides of a one-file diff's header (the `diff --git`, `---` and
// `+++` lines before the first hunk) to `label`, so the diff never names the
// scratch files it was computed from. Hunk lines are left as they are.
function relabelDiffHeader(diff: string, label: string): string {
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length && !lines[i]!.startsWith("@@"); i++) {
    const line = lines[i]!;
    if (line.startsWith("diff --git ")) lines[i] = `diff --git a/${label} b/${label}`;
    else if (line.startsWith("--- ")) lines[i] = `--- a/${label}`;
    else if (line.startsWith("+++ ")) lines[i] = `+++ b/${label}`;
  }
  return lines.join("\n");
}

function gitRunAllowFail(
  args: readonly string[],
  cwd: string,
  opts: GitRunOptions = {},
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, never> {
  return Effect.sync(() => ({ stdout: "", stderr: "", exitCode: 0 })).pipe(
    Effect.flatMap(() =>
      gitRun(args, cwd, opts).pipe(
        Effect.map((r) => ({ ...r, exitCode: 0 })),
        Effect.catchAll((err) =>
          Effect.succeed({ stdout: "", stderr: err.stderr ?? "", exitCode: err.exitCode ?? 1 }),
        ),
      ),
    ),
  );
}

const MODE_SYMLINK = "120000";
const MODE_EXECUTABLE = "100755";
const MODE_SUBMODULE = "160000";

// lstat that reads an absent path, or one under a file, as no file.
async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

function fsError(path: string, err: unknown): GitError {
  return new GitError({ message: `Could not read ${path}: ${String(err)}`, command: "lstat" });
}

// The blob id git gives `content`, in the object format of `like` (a 40- or
// 64-hex id of the same repository), computed here rather than by a process.
function blobId(content: Uint8Array, like: string): string {
  const hash = createHash(like.length === 64 ? "sha256" : "sha1");
  hash.update(`blob ${content.length}\0`);
  hash.update(content);
  return hash.digest("hex");
}

// A path as one line of `git hash-object --stdin-paths`, which reads a line
// starting with `"` as C-quoted: a path holding a newline, ending with a
// carriage return, starting with `"` or holding a backslash or a control
// character is quoted, every other path is written as is.
function stdinPathLine(path: string): string {
  const isControl = (code: number): boolean => code < 0x20 || code === 0x7f;
  const plain =
    !path.startsWith('"') &&
    ![...path].some((char) => char === "\\" || isControl(char.charCodeAt(0)));
  if (plain) return path;
  let quoted = "";
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (char === "\\" || char === '"') quoted += `\\${char}`;
    else if (isControl(code)) quoted += `\\${code.toString(8).padStart(3, "0")}`;
    else quoted += char;
  }
  return `"${quoted}"`;
}

// How each file of `entries` on disk compares with its blob at base, whatever
// the real index says, in the order given. A file is hashed as `git add`
// would (clean filters included), all of them by one `git hash-object
// --stdin-paths`, so no argument list grows with their number; a symbolic
// link is hashed here, by its target.
function compareTrackedFiles(
  worktree: string,
  entries: readonly GitTreeEntry[],
  honourFileMode: boolean,
  env: Record<string, string>,
): Effect.Effect<readonly TrackedState[], GitError> {
  return Effect.gen(function* () {
    const stats = yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.tryPromise({
          try: () => lstatOrNull(join(worktree, entry.path)),
          catch: (err) => fsError(entry.path, err),
        }),
      { concurrency: 8 },
    );
    const files = entries.filter((entry, i) => {
      const stat = stats[i];
      return stat?.isFile() === true && entry.mode !== MODE_SYMLINK;
    });
    const hashed = new Map<string, string>();
    if (files.length > 0) {
      const { stdout } = yield* gitRun(["hash-object", "--stdin-paths"], worktree, {
        env,
        input: files.map((entry) => `${stdinPathLine(entry.path)}\n`).join(""),
      });
      const ids = stdout.split("\n").filter((line) => line !== "");
      if (ids.length !== files.length) {
        return yield* Effect.fail(
          new GitError({
            message: `git hash-object --stdin-paths gave ${ids.length} ids for ${files.length} files`,
            command: "git hash-object --stdin-paths",
          }),
        );
      }
      files.forEach((entry, i) => hashed.set(entry.path, ids[i]!));
    }
    return yield* Effect.forEach(
      entries,
      (entry, i) =>
        Effect.gen(function* () {
          const stat = stats[i] ?? null;
          const baseIsLink = entry.mode === MODE_SYMLINK;
          if (stat === null || stat.isDirectory()) return "missing" as const;
          if (stat.isSymbolicLink()) {
            if (!baseIsLink) return "type" as const;
            const target = yield* Effect.tryPromise({
              try: () => readlink(join(worktree, entry.path), { encoding: "buffer" }),
              catch: (err) => fsError(entry.path, err),
            });
            return blobId(target, entry.oid) === entry.oid
              ? ("same" as const)
              : ("content" as const);
          }
          if (!stat.isFile() || baseIsLink) return "type" as const;
          if (hashed.get(entry.path) !== entry.oid) return "content" as const;
          // git reads the owner's execute bit only, and not at all under core.fileMode=false.
          const executable = (stat.mode & 0o100) !== 0;
          return honourFileMode && executable !== (entry.mode === MODE_EXECUTABLE)
            ? ("content" as const)
            : ("same" as const);
        }),
      { concurrency: 8 },
    );
  });
}

function observeWorktreeEffect(
  worktree: string,
  base: string,
  isProtected: (path: string) => boolean,
): Effect.Effect<ProtectedObservation, GitError> {
  return Effect.gen(function* () {
    // Every git run of the observation reads the objects as stored: a replace
    // ref (`git replace`) cannot stand a forged commit in for the base, or
    // for HEAD, and hide an edit.
    const env = { GIT_NO_REPLACE_OBJECTS: "1" };
    const tree = yield* snapshotWorktreeEffect(worktree, env);
    const diffArgs = ["diff-tree", "-z", "-r", "-M", "--name-status", "--no-ext-diff", base, tree];
    const { stdout: diffOut } = yield* gitRun(diffArgs, worktree, { env });
    const rows = yield* parseDiffTreeNameStatusZ(diffOut, `git ${diffArgs.join(" ")}`, true);
    const entries = rows.map((row): ObservedEntry => {
      switch (row.status) {
        case "R":
          return { status: "renamed", path: row.path, oldPath: row.oldPath };
        case "A":
          return { status: "added", path: row.path };
        case "M":
          return { status: "modified", path: row.path };
        case "D":
          return { status: "deleted", path: row.path };
        case "T":
          return { status: "type-changed", path: row.path };
      }
    });

    // The whole base tree, read once: its protected files, submodules left out.
    const { stdout: treeOut } = yield* gitRun(["ls-tree", "-r", "-z", base], worktree, { env });
    const atBase = parseLsTreeZ(treeOut).filter(
      (entry) => entry.mode !== MODE_SUBMODULE && isProtected(entry.path),
    );
    const fileMode =
      atBase.length === 0
        ? true
        : (yield* gitRunAllowFail(["config", "--type=bool", "--get", "core.filemode"], worktree, {
            env,
          })).stdout.trim() !== "false";
    const states = yield* compareTrackedFiles(worktree, atBase, fileMode, env);
    const tracked = atBase.map((entry, i) => ({ path: entry.path, state: states[i]! }));

    const { stdout: ignoredOut } = yield* gitRun(
      ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"],
      worktree,
      { env },
    );
    const untracked = ignoredOut.split("\0").filter((p) => p !== "" && !isInsidePhaxContext(p));

    return { entries, tracked, untracked };
  });
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

  // `git diff --no-index` exits 1 when the files differ: that is the diff, not
  // a failure. It also exits 1, printing nothing, on a file it cannot read, so
  // only an exit 1 with a diff on stdout succeeds. The user's external diff,
  // textconv and color config stay out of it; the header names `label`.
  diffNoIndex: (repo, beforePath, afterPath, label) => {
    const args = [
      "diff",
      "--no-index",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      beforePath,
      afterPath,
    ];
    return Effect.tryPromise({
      try: () =>
        runGitProcess(args, repo, "utf8", {}).then(
          ({ stdout }) => relabelDiffHeader(String(stdout), label),
          (err: unknown) => {
            const e = err as { code?: unknown; stdout?: unknown };
            if (e.code === 1 && typeof e.stdout === "string" && e.stdout.length > 0) {
              return relabelDiffHeader(e.stdout, label);
            }
            throw err;
          },
        ),
      catch: (err) => toGitError(err, `git ${args.join(" ")}`, args),
    });
  },

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

  // `--no-renames`: with rename detection, a deleted file paired with a
  // near-identical added one is listed only under the new path, so a footprint
  // naming the old path (a moved plan, a deleted record file) would miss it.
  changedFilesSince: (baseline, repo) =>
    gitRun(["diff", "--name-only", "--no-renames", baseline, "--"], repo).pipe(
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

  // `path` does not exist yet, so the process cwd must be its (already-created)
  // parent — the caller is responsible for mkdirp'ing it first.
  cloneRepo: (remote, path) =>
    gitRun(["clone", "--", remote, path], dirname(path)).pipe(Effect.asVoid),

  fetchRemote: (remote, repo) => gitRun(["fetch", "--", remote], repo).pipe(Effect.asVoid),

  remoteUrl: (remote, repo) =>
    gitRunAllowFail(["remote", "get-url", remote], repo).pipe(
      Effect.map(({ stdout, exitCode }) => (exitCode === 0 ? stdout.trim() : null)),
    ),

  // The name git commits under, in git's own order: GIT_COMMITTER_NAME, then
  // user.name — never the account name git would guess. `git config` exits 1
  // when the key is unset: that is no name, not an error. Any other failure
  // (not a repository, an unreadable config) is.
  committerName: (repo) => {
    const fromEnv = process.env["GIT_COMMITTER_NAME"]?.trim();
    if (fromEnv !== undefined && fromEnv.length > 0) return Effect.succeed(fromEnv);
    return gitRunAllowFail(["config", "--get", "user.name"], repo).pipe(
      Effect.flatMap(({ stdout, stderr, exitCode }) => {
        if (exitCode === 1) return Effect.succeed(null);
        if (exitCode !== 0) {
          return Effect.fail(
            new GitError({
              message: `git config --get user.name failed: ${stderr.trim()}`,
              command: "git config --get user.name",
              stderr,
              exitCode,
            }),
          );
        }
        const name = stdout.trim();
        return Effect.succeed(name.length > 0 ? name : null);
      }),
    );
  },

  // The identity git authors a commit under, in git's own order per field:
  // GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL, then author.name / author.email, then
  // user.name / user.email. Never `git var GIT_AUTHOR_IDENT`, which guesses
  // from the host name.
  authorIdentity: (repo) => {
    const readConfig = (configKey: string) =>
      gitRunAllowFail(["config", "--get", configKey], repo).pipe(
        Effect.flatMap(({ stdout, stderr, exitCode }) => {
          if (exitCode === 1) return Effect.succeed<string | null>(null);
          if (exitCode !== 0) {
            return Effect.fail(
              new GitError({
                message: `git config --get ${configKey} failed: ${stderr.trim()}`,
                command: `git config --get ${configKey}`,
                stderr,
                exitCode,
              }),
            );
          }
          const value = stdout.trim();
          return Effect.succeed<string | null>(value.length > 0 ? value : null);
        }),
      );
    const readField = (envKey: string, field: "name" | "email") =>
      Effect.gen(function* () {
        const fromEnv = process.env[envKey]?.trim();
        if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
        return (yield* readConfig(`author.${field}`)) ?? (yield* readConfig(`user.${field}`));
      });
    return Effect.gen(function* () {
      const name = yield* readField("GIT_AUTHOR_NAME", "name");
      const email = yield* readField("GIT_AUTHOR_EMAIL", "email");
      return name === null || email === null ? null : { name, email };
    });
  },

  listRefs: (repo, prefix) =>
    gitRun(["for-each-ref", "--format=%(refname)", prefix], repo).pipe(
      Effect.map(({ stdout }) => parseRefList(stdout).toSorted()),
    ),

  // Each `--exclude` applies only to the next `--branches`, and for `--branches`
  // git matches exclude patterns without the `refs/heads/` prefix, so short
  // names go here. Tags and remote-tracking refs are never excluded.
  countUnpreservedCommits: (repo, branch, deleting) => {
    const args = [
      "rev-list",
      "--count",
      `refs/heads/${branch}`,
      "--not",
      ...deleting.map((b) => `--exclude=${b}`),
      "--branches",
      "--tags",
      "--remotes",
    ];
    return gitRun(args, repo).pipe(
      Effect.flatMap(({ stdout }) => {
        const count = parseRevListCount(stdout);
        if (count === null) {
          return Effect.fail(
            new GitError({
              message: `Could not parse rev-list count: "${stdout.trim()}"`,
              command: `git ${args.join(" ")}`,
              args,
            }),
          );
        }
        return Effect.succeed(count);
      }),
    );
  },

  listWorktrees: (repo) =>
    gitRun(["worktree", "list", "--porcelain"], repo).pipe(
      Effect.map(({ stdout }) => parseWorktreeListPorcelain(stdout)),
    ),

  // `--before` compares committer dates; with nothing older, rev-list prints
  // nothing and exits 0.
  commitBefore: (repo, instant) =>
    gitRun(["rev-list", "-1", `--before=${instant}`, "HEAD"], repo).pipe(
      Effect.map(({ stdout }) => parseHeadCommitOutput(stdout)),
    ),

  // One batch-check answers every path: git prints one line per input line, in
  // order, either the size or `<object> missing`. A path holding a newline
  // cannot be asked in this protocol, so it counts as missing.
  blobSizes: (repo, commit, paths) => {
    const asked = paths.filter((path) => !path.includes("\n"));
    if (asked.length === 0) return Effect.succeed(Object.fromEntries(paths.map((p) => [p, 0])));
    return gitRun(["cat-file", "--batch-check=%(objecttype) %(objectsize)"], repo, {
      input: `${asked.map((path) => `${commit}:${path}`).join("\n")}\n`,
    }).pipe(
      Effect.map(({ stdout }) => {
        const answers = stdout.split("\n");
        const sizes: Record<string, number> = Object.fromEntries(paths.map((p) => [p, 0]));
        asked.forEach((path, i) => {
          // Only a blob counts: a tree's size is its listing, not its files.
          const blob = /^blob (\d+)$/.exec(answers[i]?.trim() ?? "");
          sizes[path] = blob === null ? 0 : Number(blob[1]);
        });
        return sizes;
      }),
    );
  },

  headTree: (path) =>
    gitRun(["rev-parse", "--verify", "HEAD^{tree}"], path).pipe(
      Effect.flatMap(({ stdout }) => parseTreeId(stdout, "git rev-parse HEAD^{tree}")),
    ),

  snapshotWorktree: (path) => snapshotWorktreeEffect(path),

  changedPathsBetween: (path, fromTree, toTree) => {
    const args = ["diff-tree", "-r", "-z", "--name-status", "--no-renames", fromTree, toTree];
    return gitRun(args, path).pipe(
      Effect.flatMap(({ stdout }) =>
        parseDiffTreeNameStatusZ(stdout, `git ${args.join(" ")}`, false),
      ),
    );
  },

  observeWorktree: (path, base, isProtected) => observeWorktreeEffect(path, base, isProtected),

  restorePaths: (path, tree, paths) => restorePathsEffect(path, tree, paths),

  diffTrees: (repo, fromTree, toTree) =>
    gitRun(
      [
        "diff-tree",
        "-p",
        "-r",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        fromTree,
        toTree,
      ],
      repo,
    ).pipe(Effect.map(({ stdout }) => stdout)),

  commitTree: (worktree, tree, subject, body) => commitTreeEffect(worktree, tree, subject, body),
});

export function makeNodeGitLayer(): Layer.Layer<Git> {
  return NodeGitLayer;
}
