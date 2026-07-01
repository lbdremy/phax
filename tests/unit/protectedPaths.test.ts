import { describe, expect, it } from "vitest";
import {
  CLAUDE_PROTECTED_PREFIXES,
  decideProtectedPathApproval,
  isProtectedPath,
  resolveProtectedApprovals,
} from "../../src/domain/security/protectedPaths.js";

describe("CLAUDE_PROTECTED_PREFIXES", () => {
  it("includes .claude/ but does not include .claude/worktrees/", () => {
    expect(CLAUDE_PROTECTED_PREFIXES).toContain(".claude/");
    expect(CLAUDE_PROTECTED_PREFIXES).not.toContain(".claude/worktrees/");
  });
});

describe("isProtectedPath", () => {
  it("returns true for .claude/skills/x.md", () => {
    expect(isProtectedPath(".claude/skills/x.md")).toBe(true);
  });

  it("returns false for .claude/worktrees/foo", () => {
    expect(isProtectedPath(".claude/worktrees/foo")).toBe(false);
  });

  it("returns false for non-protected source paths", () => {
    expect(isProtectedPath("src/x.ts")).toBe(false);
    expect(isProtectedPath("docs/security/x.md")).toBe(false);
  });

  it("normalizes leading ./ and redundant segments", () => {
    expect(isProtectedPath("./.claude/skills/y.md")).toBe(true);
    expect(isProtectedPath(".claude/./skills/../skills/y.md")).toBe(true);
  });

  it("does not match bare '.claude' directory entry as protected file (boundary)", () => {
    // `.claude` alone (without trailing path) is the configured directory
    // root; treat it as protected so an edit attempt is recognized.
    expect(isProtectedPath(".claude")).toBe(true);
  });

  it("rejects paths that escape the repo root", () => {
    expect(isProtectedPath("../outside")).toBe(false);
  });
});

describe("resolveProtectedApprovals", () => {
  const worktreeRoot = "/tmp/run/wt";

  it("partitions protected paths against allowWriteProtected prefixes", () => {
    const result = resolveProtectedApprovals({
      plannedPaths: [".claude/skills/a.md", ".claude/hooks/b.sh", "src/index.ts"],
      allowWriteProtected: [".claude/skills/"],
      worktreeRoot,
    });

    expect(result.approved).toEqual(["/tmp/run/wt/.claude/skills/a.md"]);
    expect(result.uncovered).toEqual([".claude/hooks/b.sh"]);
  });

  it("returns every protected path as uncovered when allowWriteProtected is empty", () => {
    const result = resolveProtectedApprovals({
      plannedPaths: [".claude/skills/a.md", ".claude/hooks/b.sh", "src/x.ts"],
      allowWriteProtected: [],
      worktreeRoot,
    });

    expect(result.approved).toEqual([]);
    expect(result.uncovered).toEqual([".claude/skills/a.md", ".claude/hooks/b.sh"]);
  });

  it("ignores non-protected paths entirely", () => {
    const result = resolveProtectedApprovals({
      plannedPaths: ["src/a.ts", "docs/b.md"],
      allowWriteProtected: [".claude/skills/"],
      worktreeRoot,
    });

    expect(result.approved).toEqual([]);
    expect(result.uncovered).toEqual([]);
  });

  it("deduplicates while preserving input order", () => {
    const result = resolveProtectedApprovals({
      plannedPaths: [".claude/skills/a.md", "./.claude/skills/a.md", ".claude/skills/b.md"],
      allowWriteProtected: [".claude/skills/"],
      worktreeRoot,
    });

    expect(result.approved).toEqual([
      "/tmp/run/wt/.claude/skills/a.md",
      "/tmp/run/wt/.claude/skills/b.md",
    ]);
  });

  it("treats a prefix without trailing slash the same as with one", () => {
    const result = resolveProtectedApprovals({
      plannedPaths: [".claude/skills/a.md"],
      allowWriteProtected: [".claude/skills"],
      worktreeRoot,
    });

    expect(result.approved).toEqual(["/tmp/run/wt/.claude/skills/a.md"]);
  });
});

describe("decideProtectedPathApproval", () => {
  const approvedAbsolutePaths = ["/tmp/run/wt/.claude/skills/a.md"];

  it("allows exact match on Edit", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths,
        toolName: "Edit",
        filePath: "/tmp/run/wt/.claude/skills/a.md",
      }),
    ).toBe("allow");
  });

  it("allows exact match on Write and MultiEdit", () => {
    for (const toolName of ["Write", "MultiEdit"]) {
      expect(
        decideProtectedPathApproval({
          approvedAbsolutePaths,
          toolName,
          filePath: "/tmp/run/wt/.claude/skills/a.md",
        }),
      ).toBe("allow");
    }
  });

  it("defers on a non-matching path", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths,
        toolName: "Edit",
        filePath: "/tmp/run/wt/.claude/skills/b.md",
      }),
    ).toBe("defer");
  });

  it("defers on a non-edit tool name", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths,
        toolName: "Bash",
        filePath: "/tmp/run/wt/.claude/skills/a.md",
      }),
    ).toBe("defer");
  });

  it("defers when filePath is missing", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths,
        toolName: "Edit",
        filePath: undefined,
      }),
    ).toBe("defer");
  });

  it("defers on relative filePath (must be absolute)", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths,
        toolName: "Edit",
        filePath: ".claude/skills/a.md",
      }),
    ).toBe("defer");
  });

  it("normalizes redundant path segments before matching", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths,
        toolName: "Edit",
        filePath: "/tmp/run/wt/./.claude/skills/a.md",
      }),
    ).toBe("allow");
  });
});
