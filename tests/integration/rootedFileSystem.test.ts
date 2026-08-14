import { Effect } from "effect";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { FileSystem, type FileSystemOps } from "../../src/ports/fs.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phax-rooted-fs-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const withFs = <A>(f: (fs: FileSystemOps) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(FileSystem, f).pipe(Effect.provide(NodeFileSystemLayer)));

describe("FileSystem.rootedAt (Node adapter)", () => {
  it("writes a relative path under the root, not the process cwd", async () => {
    const cwdBefore = process.cwd();
    await withFs((fs) => fs.rootedAt(tmpDir).writeAtomic("nested/file.txt", "hi"));
    expect(process.cwd()).toBe(cwdBefore);

    await expect(withFs((fs) => fs.exists(join(process.cwd(), "nested/file.txt")))).resolves.toBe(
      false,
    );

    const content = await withFs((fs) => fs.readText(join(tmpDir, "nested/file.txt")));
    expect(content).toBe("hi");
  });

  it("reads back a relative path written under the root", async () => {
    await withFs((fs) => fs.rootedAt(tmpDir).writeAtomic("a.txt", "content-a"));
    const text = await withFs((fs) => fs.rootedAt(tmpDir).readText("a.txt"));
    expect(text).toBe("content-a");
  });

  it("honours the root for mkdirp, exists, appendLine, list, rename and remove", async () => {
    await withFs((fs) => fs.rootedAt(tmpDir).mkdirp("sub/dir"));
    await expect(withFs((fs) => fs.rootedAt(tmpDir).exists("sub/dir"))).resolves.toBe(true);

    await withFs((fs) => fs.rootedAt(tmpDir).writeAtomic("sub/f1.txt", "one"));
    await withFs((fs) => fs.rootedAt(tmpDir).appendLine("sub/f1.txt", "two"));
    const appended = await withFs((fs) => fs.rootedAt(tmpDir).readText("sub/f1.txt"));
    expect(appended).toBe("onetwo\n");

    const listed = await withFs((fs) => fs.rootedAt(tmpDir).list("sub"));
    expect(listed.toSorted()).toEqual(["dir", "f1.txt"]);

    await withFs((fs) => fs.rootedAt(tmpDir).rename("sub/f1.txt", "sub/f2.txt"));
    await expect(withFs((fs) => fs.rootedAt(tmpDir).exists("sub/f1.txt"))).resolves.toBe(false);
    await expect(withFs((fs) => fs.rootedAt(tmpDir).exists("sub/f2.txt"))).resolves.toBe(true);

    await withFs((fs) => fs.rootedAt(tmpDir).remove("sub/f2.txt"));
    await expect(withFs((fs) => fs.rootedAt(tmpDir).exists("sub/f2.txt"))).resolves.toBe(false);
  });

  it("passes an absolute path through unchanged", async () => {
    const otherDir = await mkdtemp(join(tmpdir(), "phax-rooted-fs-other-"));
    try {
      const absolutePath = join(otherDir, "abs.txt");
      await withFs((fs) => fs.rootedAt(tmpDir).writeAtomic(absolutePath, "abs-content"));

      const content = await withFs((fs) => fs.readText(absolutePath));
      expect(content).toBe("abs-content");

      const rootedListing = await withFs((fs) => fs.rootedAt(tmpDir).list("."));
      expect(rootedListing).toEqual([]);
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  it("composes: rootedAt on a rooted view nests relative roots", async () => {
    await mkdir(join(tmpDir, "outer", "inner"), { recursive: true });
    await writeFile(join(tmpDir, "outer", "inner", "nested.txt"), "nested-content", "utf8");

    const text = await withFs((fs) =>
      fs.rootedAt(tmpDir).rootedAt("outer").rootedAt("inner").readText("nested.txt"),
    );
    expect(text).toBe("nested-content");
  });
});
