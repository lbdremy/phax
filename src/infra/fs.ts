import { Effect, Layer } from "effect";
import {
  open,
  mkdir,
  access,
  rm,
  rename as nodeRename,
  readFile,
  appendFile,
  readdir,
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

export function makeNodeFileSystemOps(resolvePath: (path: string) => string): FileSystemOps {
  return {
    readText: (path) =>
      Effect.tryPromise({
        try: () => readFile(resolvePath(path), "utf8"),
        catch: wrapFsError,
      }),

    writeAtomic: (path, content) =>
      Effect.tryPromise({
        try: async () => {
          const resolved = resolvePath(path);
          const dir = dirname(resolved);
          await mkdir(dir, { recursive: true });
          const rand = randomBytes(6).toString("hex");
          const tmpPath = `${resolved}.tmp.${rand}`;
          const handle = await open(tmpPath, "w");
          try {
            await handle.writeFile(content, "utf8");
            await handle.sync();
          } finally {
            await handle.close();
          }
          await nodeRename(tmpPath, resolved);
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

    mkdirp: (path) =>
      Effect.tryPromise({
        try: () => mkdir(resolvePath(path), { recursive: true }).then(() => undefined),
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
