import { Effect, Layer } from "effect";
import {
  open,
  mkdir,
  access,
  rm,
  rename as nodeRename,
  readFile,
  writeFile,
  appendFile,
  readdir,
  lstat,
  stat,
  chmod,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { FileSystem, type FileSystemOps, FsError } from "../ports/fs.js";

function wrapFsError(cause: unknown): FsError {
  return new FsError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

// Sum the lstat sizes of the regular files at or under `path`. Symlinks are
// lstat'ed, not followed, and count for nothing; an absent path is 0.
async function apparentSizeOf(path: string): Promise<number> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;
  let total = 0;
  for (const name of await readdir(path)) {
    total += await apparentSizeOf(join(path, name));
  }
  return total;
}

// The lstat size of a regular file; anything else, or nothing, is 0.
async function fileSizeOf(path: string): Promise<number> {
  try {
    const stats = await lstat(path);
    return stats.isFile() ? stats.size : 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return 0;
    throw err;
  }
}

// Write through a temporary sibling renamed into place. A given mode is set on
// the temporary file before any byte lands, so the file is never readable
// wider than asked.
async function writeAtomicFile(
  resolved: string,
  content: string | Uint8Array,
  mode: number | undefined,
): Promise<void> {
  await mkdir(dirname(resolved), { recursive: true });
  const rand = randomBytes(6).toString("hex");
  const tmpPath = `${resolved}.tmp.${rand}`;
  const handle = await open(tmpPath, "w", mode);
  try {
    if (mode !== undefined) await handle.chmod(mode);
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await nodeRename(tmpPath, resolved);
}

export function makeNodeFileSystemOps(resolvePath: (path: string) => string): FileSystemOps {
  return {
    readText: (path) =>
      Effect.tryPromise({
        try: () => readFile(resolvePath(path), "utf8"),
        catch: wrapFsError,
      }),

    readBytes: (path) =>
      Effect.tryPromise({
        try: async () => new Uint8Array(await readFile(resolvePath(path))),
        catch: wrapFsError,
      }),

    writeAtomic: (path, content) =>
      Effect.tryPromise({
        try: () => writeAtomicFile(resolvePath(path), content, undefined),
        catch: wrapFsError,
      }),

    writeAtomicBytes: (path, bytes, options) =>
      Effect.tryPromise({
        try: () => writeAtomicFile(resolvePath(path), bytes, options?.mode),
        catch: wrapFsError,
      }),

    createExclusive: (path, content) =>
      Effect.tryPromise({
        try: async () => {
          try {
            await writeFile(resolvePath(path), content, { encoding: "utf8", flag: "wx" });
            return true;
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
            throw err;
          }
        },
        catch: wrapFsError,
      }),

    appendLine: (path, line) =>
      Effect.tryPromise({
        try: async () => {
          const resolved = resolvePath(path);
          const dir = dirname(resolved);
          await mkdir(dir, { recursive: true });
          await appendFile(resolved, line + "\n", "utf8");
        },
        catch: wrapFsError,
      }),

    mkdirp: (path, options) =>
      Effect.tryPromise({
        try: async () => {
          const resolved = resolvePath(path);
          await mkdir(resolved, { recursive: true });
          if (options?.mode !== undefined) await chmod(resolved, options.mode);
        },
        catch: wrapFsError,
      }),

    exists: (path) =>
      Effect.tryPromise({
        try: () =>
          access(resolvePath(path))
            .then(() => true)
            .catch(() => false),
        catch: wrapFsError,
      }),

    remove: (path) =>
      Effect.tryPromise({
        try: () => rm(resolvePath(path), { recursive: true, force: true }),
        catch: wrapFsError,
      }),

    rename: (from, to) =>
      Effect.tryPromise({
        try: () => nodeRename(resolvePath(from), resolvePath(to)),
        catch: wrapFsError,
      }),

    list: (path) =>
      Effect.tryPromise({
        try: () => readdir(resolvePath(path)),
        catch: wrapFsError,
      }),

    apparentSize: (path) =>
      Effect.tryPromise({
        try: () => apparentSizeOf(resolvePath(path)),
        catch: wrapFsError,
      }),

    fileSize: (path) =>
      Effect.tryPromise({
        try: () => fileSizeOf(resolvePath(path)),
        catch: wrapFsError,
      }),

    modifiedAt: (path) =>
      Effect.tryPromise({
        try: async () => (await stat(resolvePath(path))).mtime.toISOString(),
        catch: wrapFsError,
      }),

    rootedAt: (root) =>
      makeNodeFileSystemOps((path) => resolvePath(isAbsolute(path) ? path : join(root, path))),
  };
}

export const NodeFileSystemLayer = Layer.succeed(
  FileSystem,
  makeNodeFileSystemOps((path) => path),
);

/**
 * Build a FileSystem layer whose relative paths resolve against `root` instead
 * of the process working directory. Absolute paths pass through unchanged, so a
 * consumer handing down an already-absolute path (a stateRoot, PHAX_HOME_DIR)
 * is unaffected. This is the composition-root primitive for rooting phax at
 * `config.repoRoot` so its FileSystem side keeps git's work-from-anywhere
 * contract; see `makeRepoRootedFileSystemLayer` in the CLI layer.
 */
export function makeRootedNodeFileSystemLayer(root: string): Layer.Layer<FileSystem> {
  return Layer.succeed(FileSystem, makeNodeFileSystemOps((path) => path).rootedAt(root));
}
