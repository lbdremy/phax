import { Effect, Layer } from "effect";
import { FileSystem, type FileSystemOps, FsError } from "../../ports/fs.js";

export class FakeFileSystemImpl implements FileSystemOps {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();

  setFile(path: string, content: string): void {
    this.files.set(path, content);
    this.registerParentDirs(path);
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

  writeAtomic(path: string, content: string): Effect.Effect<void, FsError> {
    this.files.set(path, content);
    this.registerParentDirs(path);
    return Effect.void;
  }

  mkdirp(path: string): Effect.Effect<void, FsError> {
    this.dirs.add(path);
    return Effect.void;
  }

  exists(path: string): Effect.Effect<boolean, FsError> {
    return Effect.succeed(this.files.has(path) || this.dirs.has(path));
  }

  remove(path: string): Effect.Effect<void, FsError> {
    this.files.delete(path);
    this.dirs.delete(path);
    return Effect.void;
  }

  rename(from: string, to: string): Effect.Effect<void, FsError> {
    const fromPrefix = from + "/";

    if (this.files.has(from)) {
      const content = this.files.get(from)!;
      this.files.delete(from);
      this.files.set(to, content);
    }

    const filesToRename = Array.from(this.files.entries()).filter(([key]) =>
      key.startsWith(fromPrefix),
    );
    for (const [key, val] of filesToRename) {
      this.files.delete(key);
      this.files.set(to + "/" + key.slice(fromPrefix.length), val);
    }

    if (this.dirs.has(from)) {
      this.dirs.delete(from);
      this.dirs.add(to);
    }

    const dirsToRename = Array.from(this.dirs).filter((dir) => dir.startsWith(fromPrefix));
    for (const dir of dirsToRename) {
      this.dirs.delete(dir);
      this.dirs.add(to + "/" + dir.slice(fromPrefix.length));
    }

    return Effect.void;
  }
}

export const makeFakeFileSystem = () => {
  const impl = new FakeFileSystemImpl();
  const layer = Layer.succeed(FileSystem, impl);
  return { impl, layer } as const;
};
