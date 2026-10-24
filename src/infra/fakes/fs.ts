import { Effect, Layer } from "effect";
import { isAbsolute, join } from "node:path/posix";
import { FileSystem, type FileSystemOps, FsError, type WriteModeOptions } from "../../ports/fs.js";

export class FakeFileSystemImpl implements FileSystemOps {
  readonly files = new Map<string, string>();
  /**
   * The exact bytes of each file written through `writeAtomicBytes`, kept
   * until its next text write. `files` holds their UTF-8 decoding, as the node
   * `readText` would read them.
   */
  readonly bytes = new Map<string, Uint8Array>();
  /** The mode each file or folder was last written or created with, when one was given. */
  readonly modes = new Map<string, number>();
  readonly dirs = new Set<string>();
  readonly modified = new Map<string, string>();
  private writes = 0;

  setFile(path: string, content: string): void {
    this.files.set(path, content);
    this.bytes.delete(path);
    this.touch(path);
    this.registerParentDirs(path);
  }

  /** Sets the instant `modifiedAt` reports for `path` until its next write. */
  setModifiedAt(path: string, instant: string): void {
    this.modified.set(path, instant);
  }

  // Every write stamps a distinct, ascending made-up instant.
  private touch(path: string): void {
    this.writes += 1;
    this.modified.set(path, new Date(Date.UTC(2026, 0, 1) + this.writes * 1000).toISOString());
  }

  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  addDir(path: string): void {
    this.dirs.add(path);
  }

  private registerParentDirs(filePath: string): void {
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") || "/";
      this.dirs.add(dir);
    }
  }

  readText(path: string): Effect.Effect<string, FsError> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Effect.fail(new FsError({ message: `ENOENT: no such file: ${path}` }));
    }
    return Effect.succeed(content);
  }

  readBytes(path: string): Effect.Effect<Uint8Array, FsError> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Effect.fail(new FsError({ message: `ENOENT: no such file: ${path}` }));
    }
    return Effect.succeed(Uint8Array.from(this.byteContent(path, content)));
  }

  // A file's bytes: the exact ones written, else its text encoded as UTF-8.
  private byteContent(path: string, content: string): Uint8Array {
    return this.bytes.get(path) ?? new TextEncoder().encode(content);
  }

  appendLine(path: string, line: string): Effect.Effect<void, FsError> {
    const existing = this.files.get(path) ?? "";
    this.files.set(path, existing + line + "\n");
    this.bytes.delete(path);
    this.touch(path);
    this.registerParentDirs(path);
    return Effect.void;
  }

  writeAtomic(path: string, content: string): Effect.Effect<void, FsError> {
    this.files.set(path, content);
    this.bytes.delete(path);
    this.touch(path);
    this.registerParentDirs(path);
    return Effect.void;
  }

  writeAtomicBytes(
    path: string,
    bytes: Uint8Array,
    options?: WriteModeOptions,
  ): Effect.Effect<void, FsError> {
    this.files.set(path, new TextDecoder().decode(bytes));
    this.bytes.set(path, Uint8Array.from(bytes));
    if (options?.mode !== undefined) this.modes.set(path, options.mode);
    else this.modes.delete(path);
    this.touch(path);
    this.registerParentDirs(path);
    return Effect.void;
  }

  createExclusive(path: string, content: string): Effect.Effect<boolean, FsError> {
    if (this.files.has(path) || this.dirs.has(path)) return Effect.succeed(false);
    this.files.set(path, content);
    this.bytes.delete(path);
    this.touch(path);
    this.registerParentDirs(path);
    return Effect.succeed(true);
  }

  mkdirp(path: string, options?: WriteModeOptions): Effect.Effect<void, FsError> {
    this.dirs.add(path);
    if (options?.mode !== undefined) this.modes.set(path, options.mode);
    return Effect.void;
  }

  exists(path: string): Effect.Effect<boolean, FsError> {
    return Effect.succeed(this.files.has(path) || this.dirs.has(path));
  }

  private readonly removeFailures = new Map<string, string>();

  /** Makes the next `remove` of exactly `path` fail with an FsError carrying `message`. */
  failRemove(path: string, message: string): void {
    this.removeFailures.set(path, message);
  }

  // Recursive like the real `rm -rf`: the key itself and everything under it.
  remove(path: string): Effect.Effect<void, FsError> {
    const failure = this.removeFailures.get(path);
    if (failure !== undefined) {
      this.removeFailures.delete(path);
      return Effect.fail(new FsError({ message: failure }));
    }
    const prefix = path + "/";
    this.forget(path);
    this.dirs.delete(path);
    for (const key of Array.from(this.files.keys())) {
      if (key.startsWith(prefix)) this.forget(key);
    }
    for (const dir of Array.from(this.dirs)) {
      if (dir.startsWith(prefix)) {
        this.dirs.delete(dir);
        this.modes.delete(dir);
      }
    }
    return Effect.void;
  }

  private forget(path: string): void {
    this.files.delete(path);
    this.bytes.delete(path);
    this.modes.delete(path);
    this.modified.delete(path);
  }

  apparentSize(path: string): Effect.Effect<number, FsError> {
    const prefix = path + "/";
    let total = 0;
    for (const [key, content] of this.files) {
      if (key === path || key.startsWith(prefix)) {
        total += this.byteContent(key, content).byteLength;
      }
    }
    return Effect.succeed(total);
  }

  fileSize(path: string): Effect.Effect<number, FsError> {
    const content = this.files.get(path);
    return Effect.succeed(content === undefined ? 0 : this.byteContent(path, content).byteLength);
  }

  modifiedAt(path: string): Effect.Effect<string, FsError> {
    const instant = this.files.has(path) ? this.modified.get(path) : undefined;
    if (instant === undefined) {
      return Effect.fail(new FsError({ message: `ENOENT: no such file: ${path}` }));
    }
    return Effect.succeed(instant);
  }

  list(path: string): Effect.Effect<readonly string[], FsError> {
    const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
    if (!this.dirs.has(normalizedPath) && !this.files.has(normalizedPath)) {
      return Effect.fail(new FsError({ message: `ENOENT: no such directory: ${path}` }));
    }
    const prefix = normalizedPath + "/";
    const names = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment !== undefined) names.add(segment);
      }
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment !== undefined && !rest.includes("/")) names.add(segment);
      }
    }
    return Effect.succeed(Array.from(names).toSorted());
  }

  rename(from: string, to: string): Effect.Effect<void, FsError> {
    const fromPrefix = from + "/";

    if (this.files.has(from)) {
      const content = this.files.get(from)!;
      this.files.delete(from);
      this.files.set(to, content);
      this.moveEntry(from, to);
    }

    const filesToRename = Array.from(this.files.entries()).filter(([key]) =>
      key.startsWith(fromPrefix),
    );
    for (const [key, val] of filesToRename) {
      this.files.delete(key);
      this.files.set(to + "/" + key.slice(fromPrefix.length), val);
      this.moveEntry(key, to + "/" + key.slice(fromPrefix.length));
    }

    if (this.dirs.has(from)) {
      this.dirs.delete(from);
      this.dirs.add(to);
      this.moveIn(this.modes, from, to);
    }

    const dirsToRename = Array.from(this.dirs).filter((dir) => dir.startsWith(fromPrefix));
    for (const dir of dirsToRename) {
      this.dirs.delete(dir);
      this.dirs.add(to + "/" + dir.slice(fromPrefix.length));
      this.moveIn(this.modes, dir, to + "/" + dir.slice(fromPrefix.length));
    }

    return Effect.void;
  }

  // A renamed file keeps its instant, its exact bytes and its mode.
  private moveEntry(from: string, to: string): void {
    this.moveIn(this.modified, from, to);
    this.moveIn(this.bytes, from, to);
    this.moveIn(this.modes, from, to);
  }

  private moveIn<V>(map: Map<string, V>, from: string, to: string): void {
    const value = map.get(from);
    map.delete(from);
    if (value !== undefined) map.set(to, value);
    else map.delete(to);
  }

  rootedAt(root: string): FileSystemOps {
    return makeRootedFakeFileSystemOps(this, root);
  }
}

function makeRootedFakeFileSystemOps(base: FakeFileSystemImpl, root: string): FileSystemOps {
  const resolveKey = (path: string): string => (isAbsolute(path) ? path : join(root, path));
  return {
    readText: (path) => base.readText(resolveKey(path)),
    readBytes: (path) => base.readBytes(resolveKey(path)),
    writeAtomic: (path, content) => base.writeAtomic(resolveKey(path), content),
    writeAtomicBytes: (path, bytes, options) =>
      base.writeAtomicBytes(resolveKey(path), bytes, options),
    createExclusive: (path, content) => base.createExclusive(resolveKey(path), content),
    appendLine: (path, line) => base.appendLine(resolveKey(path), line),
    mkdirp: (path, options) => base.mkdirp(resolveKey(path), options),
    exists: (path) => base.exists(resolveKey(path)),
    remove: (path) => base.remove(resolveKey(path)),
    rename: (from, to) => base.rename(resolveKey(from), resolveKey(to)),
    list: (path) => base.list(resolveKey(path)),
    apparentSize: (path) => base.apparentSize(resolveKey(path)),
    fileSize: (path) => base.fileSize(resolveKey(path)),
    modifiedAt: (path) => base.modifiedAt(resolveKey(path)),
    rootedAt: (nestedRoot) => makeRootedFakeFileSystemOps(base, resolveKey(nestedRoot)),
  };
}

export const makeFakeFileSystem = () => {
  const impl = new FakeFileSystemImpl();
  const layer = Layer.succeed(FileSystem, impl);
  return { impl, layer } as const;
};
