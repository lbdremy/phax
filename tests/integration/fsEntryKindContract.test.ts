import { Effect } from "effect";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { FileSystem, type EntryKind, type FileSystemOps } from "../../src/ports/fs.js";
import { removeTempDir } from "../helpers/tempGit.js";

// One suite, run against the fake and the real filesystem: what `entryKind`
// answers for each kind of entry, a symbolic link never followed at the path
// itself and followed among its parents, as lstat does.

interface World {
  readonly root: string;
  readonly ops: FileSystemOps;
  readonly dir: (path: string) => void;
  readonly file: (path: string) => void;
  readonly symlink: (path: string, target: string) => void;
  readonly other: (path: string) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const kindOf = (world: World, path: string): Promise<EntryKind> =>
  Effect.runPromise(world.ops.entryKind(path));

function fakeWorld(): World {
  const { impl } = makeFakeFileSystem();
  return {
    root: "/w",
    ops: impl,
    dir: (path) => impl.addDir(path),
    file: (path) => impl.setFile(path, "x"),
    symlink: (path, target) => impl.setSymlink(path, target),
    other: (path) => {
      impl.setOther(path);
      return Promise.resolve();
    },
    dispose: () => Promise.resolve(),
  };
}

function nodeWorld(): World {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-entry-kind-")));
  const servers: Server[] = [];
  return {
    root,
    ops: Effect.runSync(
      Effect.flatMap(FileSystem, (fs) => Effect.succeed(fs)).pipe(
        Effect.provide(NodeFileSystemLayer),
      ),
    ),
    dir: (path) => mkdirSync(path, { recursive: true }),
    file: (path) => writeFileSync(path, "x"),
    symlink: (path, target) => symlinkSync(target, path),
    // A unix socket: neither a file, a directory nor a link.
    other: (path) =>
      new Promise((resolve, reject) => {
        const server = createServer();
        servers.push(server);
        server.once("error", reject);
        server.listen(path, () => resolve());
      }),
    dispose: async () => {
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
      removeTempDir(root);
    },
  };
}

let world: World | undefined;

afterEach(async () => {
  await world?.dispose();
  world = undefined;
});

describe.each([
  ["fake", fakeWorld],
  ["node", nodeWorld],
])("FileSystem.entryKind (%s)", (_name, make) => {
  it("reports a missing path as absent", async () => {
    world = make();
    await expect(kindOf(world, join(world.root, "missing"))).resolves.toEqual({ kind: "absent" });
  });

  it("reports a path under a file as absent", async () => {
    world = make();
    world.file(join(world.root, "plain"));
    await expect(kindOf(world, join(world.root, "plain", "child"))).resolves.toEqual({
      kind: "absent",
    });
  });

  it("reports a directory", async () => {
    world = make();
    world.dir(join(world.root, "folder"));
    await expect(kindOf(world, join(world.root, "folder"))).resolves.toEqual({
      kind: "directory",
    });
  });

  it("reports a regular file", async () => {
    world = make();
    world.file(join(world.root, "plain"));
    await expect(kindOf(world, join(world.root, "plain"))).resolves.toEqual({ kind: "file" });
  });

  it("reports a symbolic link with its target, without following it", async () => {
    world = make();
    world.dir(join(world.root, "outside"));
    world.symlink(join(world.root, "link"), join(world.root, "outside"));
    world.symlink(join(world.root, "dangling"), "nowhere/at-all");
    await expect(kindOf(world, join(world.root, "link"))).resolves.toEqual({
      kind: "symlink",
      target: join(world.root, "outside"),
    });
    await expect(kindOf(world, join(world.root, "dangling"))).resolves.toEqual({
      kind: "symlink",
      target: "nowhere/at-all",
    });
  });

  it("follows a symbolic link among the parents, as lstat does", async () => {
    world = make();
    world.dir(join(world.root, "outside"));
    world.file(join(world.root, "outside", "inner"));
    world.symlink(join(world.root, "link"), "outside");
    await expect(kindOf(world, join(world.root, "link", "inner"))).resolves.toEqual({
      kind: "file",
    });
  });

  it("reports any other entry as other", async () => {
    world = make();
    // A short name: a unix socket's path is limited in length.
    await world.other(join(world.root, "s"));
    await expect(kindOf(world, join(world.root, "s"))).resolves.toEqual({ kind: "other" });
  });

  it("resolves relative paths against the root of a rooted view", async () => {
    world = make();
    world.symlink(join(world.root, "link"), "elsewhere");
    const rooted = world.ops.rootedAt(world.root);
    await expect(Effect.runPromise(rooted.entryKind("link"))).resolves.toEqual({
      kind: "symlink",
      target: "elsewhere",
    });
  });
});

describe("FileSystem.entryKind (rooted node layer)", () => {
  it("resolves relative paths against the layer's root", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-entry-kind-")));
    try {
      writeFileSync(join(root, "plain"), "x");
      const kind = await Effect.runPromise(
        Effect.flatMap(FileSystem, (fs) => fs.entryKind("plain")).pipe(
          Effect.provide(makeRootedNodeFileSystemLayer(root)),
        ),
      );
      expect(kind).toEqual({ kind: "file" });
    } finally {
      removeTempDir(root);
    }
  });
});
