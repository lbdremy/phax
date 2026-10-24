import { Context, Data, Effect } from "effect";

export class FsError extends Data.TaggedError("FsError")<{
  message: string;
  cause?: unknown;
}> {}

/** Permissions for a file or folder phax creates, such as 0o600 or 0o700. */
export interface WriteModeOptions {
  readonly mode?: number | undefined;
}

export interface FileSystemOps {
  readText(path: string): Effect.Effect<string, FsError>;
  /** The file's bytes exactly, whatever their encoding. */
  readBytes(path: string): Effect.Effect<Uint8Array, FsError>;
  writeAtomic(path: string, content: string): Effect.Effect<void, FsError>;
  /**
   * Writes `bytes` exactly at `path`, through a temporary file renamed into
   * place. `mode`, when given, is the written file's permissions.
   */
  writeAtomicBytes(
    path: string,
    bytes: Uint8Array,
    options?: WriteModeOptions,
  ): Effect.Effect<void, FsError>;
  /**
   * Writes `content` at `path` only when nothing exists there yet, and says
   * whether it did: false means something was already there, left untouched.
   * Never overwrites, so concurrent callers can each claim a distinct name.
   */
  createExclusive(path: string, content: string): Effect.Effect<boolean, FsError>;
  appendLine(path: string, line: string): Effect.Effect<void, FsError>;
  /** `mode`, when given, is set on the folder at `path`, whether or not it existed. */
  mkdirp(path: string, options?: WriteModeOptions): Effect.Effect<void, FsError>;
  exists(path: string): Effect.Effect<boolean, FsError>;
  remove(path: string): Effect.Effect<void, FsError>;
  rename(from: string, to: string): Effect.Effect<void, FsError>;
  list(path: string): Effect.Effect<readonly string[], FsError>;
  /**
   * The sum of the lstat sizes of the regular files at or under `path`, with
   * symlinks not followed, or 0 when `path` does not exist.
   */
  apparentSize(path: string): Effect.Effect<number, FsError>;
  /**
   * The lstat size of the regular file at `path`, or 0 when `path` does not
   * exist or is not a regular file: a directory, a symlink, or a path under a
   * file.
   */
  fileSize(path: string): Effect.Effect<number, FsError>;
  /** The ISO-8601 instant of the last modification of the file at `path`. */
  modifiedAt(path: string): Effect.Effect<string, FsError>;
  /**
   * Returns a view of the same filesystem whose relative paths resolve
   * against `root` instead of the process cwd. Absolute paths passed to the
   * returned ops pass through unchanged. Rooting a rooted view composes.
   */
  rootedAt(root: string): FileSystemOps;
}

export class FileSystem extends Context.Tag("phax/FileSystem")<FileSystem, FileSystemOps>() {}
