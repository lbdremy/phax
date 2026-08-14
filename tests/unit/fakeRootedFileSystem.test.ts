import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { FakeFileSystemImpl } from "../../src/infra/fakes/fs.js";

describe("FakeFileSystemImpl.rootedAt", () => {
  it("makes a write through the rooted view readable from the base at the joined key", async () => {
    const base = new FakeFileSystemImpl();
    const rooted = base.rootedAt("worktree");

    await Effect.runPromise(rooted.writeAtomic("docs/plans/foo.md", "content"));

    expect(base.getFile("worktree/docs/plans/foo.md")).toBe("content");
  });

  it("makes a write through the base readable from the rooted view at the relative key", async () => {
    const base = new FakeFileSystemImpl();
    base.setFile("worktree/docs/plans/foo.md", "content");

    const rooted = base.rootedAt("worktree");
    const text = await Effect.runPromise(rooted.readText("docs/plans/foo.md"));

    expect(text).toBe("content");
  });

  it("passes absolute paths through unchanged, bypassing the root join", async () => {
    const base = new FakeFileSystemImpl();
    const rooted = base.rootedAt("worktree");

    await Effect.runPromise(rooted.writeAtomic("/abs/file.md", "abs-content"));

    expect(base.getFile("/abs/file.md")).toBe("abs-content");
    expect(base.getFile("worktree/abs/file.md")).toBeUndefined();

    const text = await Effect.runPromise(rooted.readText("/abs/file.md"));
    expect(text).toBe("abs-content");
  });

  it("shares exists, remove and rename with the base instance", async () => {
    const base = new FakeFileSystemImpl();
    const rooted = base.rootedAt("worktree");

    await Effect.runPromise(rooted.writeAtomic("a.txt", "one"));
    await expect(Effect.runPromise(rooted.exists("a.txt"))).resolves.toBe(true);
    await expect(Effect.runPromise(base.exists("worktree/a.txt"))).resolves.toBe(true);

    await Effect.runPromise(rooted.rename("a.txt", "b.txt"));
    expect(base.getFile("worktree/a.txt")).toBeUndefined();
    expect(base.getFile("worktree/b.txt")).toBe("one");

    await Effect.runPromise(rooted.remove("b.txt"));
    await expect(Effect.runPromise(base.exists("worktree/b.txt"))).resolves.toBe(false);
  });

  it("lists directory entries scoped to the root", async () => {
    const base = new FakeFileSystemImpl();
    const rooted = base.rootedAt("worktree");

    await Effect.runPromise(rooted.writeAtomic("dir/one.txt", "1"));
    await Effect.runPromise(rooted.writeAtomic("dir/two.txt", "2"));
    base.setFile("outside/dir/three.txt", "3");

    const listed = await Effect.runPromise(rooted.list("dir"));
    expect(listed.toSorted()).toEqual(["one.txt", "two.txt"]);
  });

  it("composes when rooting a rooted view against a relative root", async () => {
    const base = new FakeFileSystemImpl();
    const nested = base.rootedAt("worktree").rootedAt("sub");

    await Effect.runPromise(nested.writeAtomic("file.txt", "nested-content"));

    expect(base.getFile("worktree/sub/file.txt")).toBe("nested-content");
  });

  it("composes when rooting a rooted view against an absolute root", async () => {
    const base = new FakeFileSystemImpl();
    const nested = base.rootedAt("worktree").rootedAt("/abs-root");

    await Effect.runPromise(nested.writeAtomic("file.txt", "abs-nested"));

    expect(base.getFile("/abs-root/file.txt")).toBe("abs-nested");
    expect(base.getFile("worktree/abs-root/file.txt")).toBeUndefined();
  });
});
