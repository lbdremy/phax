import { Effect, Layer } from "effect";
import { open, mkdir, access, rm, rename as nodeRename, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { FileSystem, FsError } from "../ports/fs.js";

function wrapFsError(cause: unknown): FsError {
  return new FsError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export const NodeFileSystemLayer = Layer.succeed(FileSystem, {
  readText: (path) =>
    Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: wrapFsError,
    }),

  writeAtomic: (path, content) =>
    Effect.tryPromise({
      try: async () => {
        const dir = dirname(path);
        await mkdir(dir, { recursive: true });
        const rand = randomBytes(6).toString("hex");
        const tmpPath = `${path}.tmp.${rand}`;
        const handle = await open(tmpPath, "w");
        try {
          await handle.writeFile(content, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await nodeRename(tmpPath, path);
      },
      catch: wrapFsError,
    }),

  mkdirp: (path) =>
    Effect.tryPromise({
      try: () => mkdir(path, { recursive: true }).then(() => undefined),
      catch: wrapFsError,
    }),

  exists: (path) =>
    Effect.tryPromise({
      try: () =>
        access(path)
          .then(() => true)
          .catch(() => false),
      catch: wrapFsError,
    }),

  remove: (path) =>
    Effect.tryPromise({
      try: () => rm(path, { recursive: true, force: true }),
      catch: wrapFsError,
    }),

  rename: (from, to) =>
    Effect.tryPromise({
      try: () => nodeRename(from, to),
      catch: wrapFsError,
    }),
});
