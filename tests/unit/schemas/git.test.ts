import { describe, expect, it } from "vitest";
import {
  parseDirtyPaths,
  parseRefList,
  parseRevListCount,
  parseWorktreeListPorcelain,
} from "../../../src/schemas/git.js";

describe("parseRefList", () => {
  it("returns one trimmed ref per non-empty line", () => {
    expect(parseRefList("refs/heads/main\n\n  refs/heads/phax/x  \n\n")).toEqual([
      "refs/heads/main",
      "refs/heads/phax/x",
    ]);
  });

  it("returns an empty array for empty output", () => {
    expect(parseRefList("")).toEqual([]);
  });
});

describe("parseRevListCount", () => {
  it("parses a valid count", () => {
    expect(parseRevListCount("3\n")).toBe(3);
    expect(parseRevListCount("0\n")).toBe(0);
  });

  it("returns null for empty output", () => {
    expect(parseRevListCount("")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseRevListCount("fatal: bad revision\n")).toBeNull();
    expect(parseRevListCount("-1\n")).toBeNull();
    expect(parseRevListCount("1.5\n")).toBeNull();
  });
});

describe("parseWorktreeListPorcelain", () => {
  const sha = "a".repeat(40);

  it("parses a main worktree and a linked worktree on a branch", () => {
    const output =
      `worktree /repo\nHEAD ${sha}\nbranch refs/heads/main\n\n` +
      `worktree /state/worktrees/ns.x/phase-01\nHEAD ${sha}\nbranch refs/heads/phax/x--phase-01\n\n`;
    expect(parseWorktreeListPorcelain(output)).toEqual([
      { path: "/repo", branch: "main", prunable: false },
      { path: "/state/worktrees/ns.x/phase-01", branch: "phax/x--phase-01", prunable: false },
    ]);
  });

  it("gives a null branch to a detached entry", () => {
    const output = `worktree /wt\nHEAD ${sha}\ndetached\n\n`;
    expect(parseWorktreeListPorcelain(output)).toEqual([
      { path: "/wt", branch: null, prunable: false },
    ]);
  });

  it("gives a null branch to a bare entry", () => {
    expect(parseWorktreeListPorcelain("worktree /bare.git\nbare\n\n")).toEqual([
      { path: "/bare.git", branch: null, prunable: false },
    ]);
  });

  it("flags a prunable entry and tolerates a locked line", () => {
    const output =
      `worktree /gone\nHEAD ${sha}\nbranch refs/heads/phax/x\nprunable gitdir file points to non-existent location\n\n` +
      `worktree /held\nHEAD ${sha}\nbranch refs/heads/phax/y\nlocked on a usb drive\n\n` +
      `worktree /bare-prunable\nHEAD ${sha}\ndetached\nlocked\nprunable\n`;
    expect(parseWorktreeListPorcelain(output)).toEqual([
      { path: "/gone", branch: "phax/x", prunable: true },
      { path: "/held", branch: "phax/y", prunable: false },
      { path: "/bare-prunable", branch: null, prunable: true },
    ]);
  });

  it("returns an empty array for empty output", () => {
    expect(parseWorktreeListPorcelain("")).toEqual([]);
  });
});

describe("parseDirtyPaths", () => {
  it("returns an empty array for empty output", () => {
    expect(parseDirtyPaths("")).toEqual([]);
  });

  it("parses a modified path", () => {
    expect(parseDirtyPaths(" M src/foo.ts\n")).toEqual(["src/foo.ts"]);
  });

  it("parses a staged path", () => {
    expect(parseDirtyPaths("M  src/foo.ts\n")).toEqual(["src/foo.ts"]);
  });

  it("parses an untracked path", () => {
    expect(parseDirtyPaths("?? src/new.ts\n")).toEqual(["src/new.ts"]);
  });

  it("parses both sides of a rename line", () => {
    expect(parseDirtyPaths("R  old.ts -> new.ts\n")).toEqual(["old.ts", "new.ts"]);
  });

  it("unquotes a quoted path with an escaped double-quote", () => {
    expect(parseDirtyPaths('?? "docs/plans/a\\"b.md"\n')).toEqual(['docs/plans/a"b.md']);
  });

  it("unquotes both sides of a quoted rename", () => {
    expect(parseDirtyPaths('R  "a\\"b.md" -> "c\\\\d.md"\n')).toEqual(['a"b.md', "c\\d.md"]);
  });

  it("parses multiple lines", () => {
    const output = " M src/foo.ts\n?? src/new.ts\nR  old.ts -> new.ts\n";
    expect(parseDirtyPaths(output)).toEqual(["src/foo.ts", "src/new.ts", "old.ts", "new.ts"]);
  });
});
