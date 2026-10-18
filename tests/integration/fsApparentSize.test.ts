import { Effect } from "effect";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { FileSystem, type FileSystemOps } from "../../src/ports/fs.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phax-fs-apparent-size-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const withFs = <A>(f: (fs: FileSystemOps) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(FileSystem, f).pipe(Effect.provide(NodeFileSystemLayer)));

describe("FileSystem.apparentSize (Node adapter)", () => {
  it("sums the sizes of nested regular files", async () => {
    const root = join(tmpDir, "archive");
    await mkdir(join(root, "runs", "deep"), { recursive: true });
    await mkdir(join(root, "worktrees"), { recursive: true });
    await writeFile(join(root, "top.txt"), "x".repeat(10));
    await writeFile(join(root, "runs", "a.json"), "y".repeat(100));
    await writeFile(join(root, "runs", "deep", "b.log"), "z".repeat(1000));

    await expect(withFs((fs) => fs.apparentSize(root))).resolves.toBe(1110);
  });

  it("returns the size of a single file", async () => {
    await writeFile(join(tmpDir, "one.txt"), "hello");
    await expect(withFs((fs) => fs.apparentSize(join(tmpDir, "one.txt")))).resolves.toBe(5);
  });

  it("returns 0 for an absent path", async () => {
    await expect(withFs((fs) => fs.apparentSize(join(tmpDir, "missing")))).resolves.toBe(0);
  });

  it("does not follow a symlink to a large file", async () => {
    const big = join(tmpDir, "big.bin");
    await writeFile(big, Buffer.alloc(1024 * 1024));
    const root = join(tmpDir, "archive");
    await mkdir(root);
    await writeFile(join(root, "small.txt"), "abc");
    await symlink(big, join(root, "link-to-big"));
    await symlink(tmpDir, join(root, "link-to-dir"));

    await expect(withFs((fs) => fs.apparentSize(root))).resolves.toBe(3);
  });

  it("resolves a relative path against a rooted view", async () => {
    await mkdir(join(tmpDir, "nested"));
    await writeFile(join(tmpDir, "nested", "f.txt"), "1234");
    await expect(withFs((fs) => fs.rootedAt(tmpDir).apparentSize("nested"))).resolves.toBe(4);
  });
});

describe("FileSystem.modifiedAt (Node adapter)", () => {
  it("returns the file's mtime as an ISO instant, through a rooted view too", async () => {
    const path = join(tmpDir, "stream.jsonl");
    await writeFile(path, "{}");
    const mtime = new Date("2026-03-04T05:06:07.000Z");
    await utimes(path, mtime, mtime);

    await expect(withFs((fs) => fs.modifiedAt(path))).resolves.toBe("2026-03-04T05:06:07.000Z");
    await expect(withFs((fs) => fs.rootedAt(tmpDir).modifiedAt("stream.jsonl"))).resolves.toBe(
      "2026-03-04T05:06:07.000Z",
    );
  });

  it("fails for an absent file", async () => {
    await expect(withFs((fs) => fs.modifiedAt(join(tmpDir, "missing")))).rejects.toThrow();
  });
});

describe("FileSystem.fileSize (Node adapter)", () => {
  it("is a regular file's size", async () => {
    await writeFile(join(tmpDir, "one.txt"), "hello");
    await expect(withFs((fs) => fs.fileSize(join(tmpDir, "one.txt")))).resolves.toBe(5);
  });

  it("is 0 for a directory, however much it holds", async () => {
    await mkdir(join(tmpDir, "src"));
    await writeFile(join(tmpDir, "src", "a.ts"), "x".repeat(100));
    await expect(withFs((fs) => fs.fileSize(join(tmpDir, "src")))).resolves.toBe(0);
  });

  it("is 0 for an absent path, a path under a file, and a symlink", async () => {
    await writeFile(join(tmpDir, "file.txt"), "abc");
    await symlink(join(tmpDir, "file.txt"), join(tmpDir, "link"));
    await expect(withFs((fs) => fs.fileSize(join(tmpDir, "missing")))).resolves.toBe(0);
    await expect(withFs((fs) => fs.fileSize(join(tmpDir, "file.txt", "under")))).resolves.toBe(0);
    await expect(withFs((fs) => fs.fileSize(join(tmpDir, "link")))).resolves.toBe(0);
  });
});
