import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { FileSystem, type FileSystemOps } from "../../src/ports/fs.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phax-fs-create-exclusive-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const withNodeFs = <A>(f: (fs: FileSystemOps) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(FileSystem, f).pipe(Effect.provide(NodeFileSystemLayer)));

describe("FileSystem.createExclusive (Node adapter)", () => {
  it("creates once, then returns false and leaves the content unchanged", async () => {
    const path = join(tmpDir, "brief-01.json");
    await expect(withNodeFs((fs) => fs.createExclusive(path, "first"))).resolves.toBe(true);
    await expect(withNodeFs((fs) => fs.createExclusive(path, "second"))).resolves.toBe(false);
    await expect(readFile(path, "utf8")).resolves.toBe("first");
  });

  it("returns false over an existing directory", async () => {
    await expect(withNodeFs((fs) => fs.createExclusive(tmpDir, "x"))).resolves.toBe(false);
  });

  it("fails when the parent directory is missing", async () => {
    const path = join(tmpDir, "missing", "brief-01.json");
    await expect(withNodeFs((fs) => fs.createExclusive(path, "x"))).rejects.toThrow();
  });

  it("gives concurrent claims of one path a single winner", async () => {
    const path = join(tmpDir, "brief-01.json");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, n) => withNodeFs((fs) => fs.createExclusive(path, `${n}`))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("resolves relative paths against the root of a rooted view", async () => {
    const rooted = <A>(f: (fs: FileSystemOps) => Effect.Effect<A, unknown>): Promise<A> =>
      Effect.runPromise(
        Effect.flatMap(FileSystem, f).pipe(Effect.provide(makeRootedNodeFileSystemLayer(tmpDir))),
      );
    await expect(rooted((fs) => fs.createExclusive("brief-02.json", "first"))).resolves.toBe(true);
    await expect(rooted((fs) => fs.createExclusive("brief-02.json", "second"))).resolves.toBe(
      false,
    );
    await expect(readFile(join(tmpDir, "brief-02.json"), "utf8")).resolves.toBe("first");
  });
});

describe("FileSystem.createExclusive (fake)", () => {
  it("creates once, then returns false and leaves the content unchanged", async () => {
    const { impl } = makeFakeFileSystem();
    await expect(
      Effect.runPromise(impl.createExclusive("/w/brief-01.json", "first")),
    ).resolves.toBe(true);
    await expect(
      Effect.runPromise(impl.createExclusive("/w/brief-01.json", "second")),
    ).resolves.toBe(false);
    expect(impl.getFile("/w/brief-01.json")).toBe("first");
    await expect(Effect.runPromise(impl.list("/w"))).resolves.toEqual(["brief-01.json"]);
  });

  it("returns false over an existing directory", async () => {
    const { impl } = makeFakeFileSystem();
    impl.addDir("/w/briefs");
    await expect(Effect.runPromise(impl.createExclusive("/w/briefs", "x"))).resolves.toBe(false);
  });

  it("resolves relative paths against the root of a rooted view", async () => {
    const { impl } = makeFakeFileSystem();
    const rooted = impl.rootedAt("/w");
    await expect(Effect.runPromise(rooted.createExclusive("brief-02.json", "first"))).resolves.toBe(
      true,
    );
    await expect(
      Effect.runPromise(rooted.createExclusive("brief-02.json", "second")),
    ).resolves.toBe(false);
    expect(impl.getFile("/w/brief-02.json")).toBe("first");
  });
});
