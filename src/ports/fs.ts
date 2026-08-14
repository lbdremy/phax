import { Context, Data, Effect } from "effect";

export class FsError extends Data.TaggedError("FsError")<{
  message: string;
  cause?: unknown;
}> {}

export interface FileSystemOps {
  readText(path: string): Effect.Effect<string, FsError>;
  writeAtomic(path: string, content: string): Effect.Effect<void, FsError>;
  appendLine(path: string, line: string): Effect.Effect<void, FsError>;
  mkdirp(path: string): Effect.Effect<void, FsError>;
  exists(path: string): Effect.Effect<boolean, FsError>;
  remove(path: string): Effect.Effect<void, FsError>;
  rename(from: string, to: string): Effect.Effect<void, FsError>;
  list(path: string): Effect.Effect<readonly string[], FsError>;
  /**
   * Returns a view of the same filesystem whose relative paths resolve
   * against `root` instead of the process cwd. Absolute paths passed to the
   * returned ops pass through unchanged. Rooting a rooted view composes.
   */
  rootedAt(root: string): FileSystemOps;
}

export class FileSystem extends Context.Tag("phax/FileSystem")<FileSystem, FileSystemOps>() {}
