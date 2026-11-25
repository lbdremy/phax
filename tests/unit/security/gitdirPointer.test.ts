import { describe, expect, it } from "vitest";
import {
  gitdirPointerVerdict,
  parseGitdirPointer,
  renderGitdirPointerRefusal,
  type GitdirEntry,
} from "../../../src/domain/security/gitdirPointer.js";

const ROOT = "/state/worktrees/run/phase-01";
const EXPECTED = "/repo/.git/worktrees/phase-01";

const file = (text: string): GitdirEntry => ({ kind: "file", text, linkTarget: null });

function verdictOf(entry: GitdirEntry) {
  const parsed =
    entry.kind === "file" && entry.text !== null ? parseGitdirPointer(entry.text, ROOT) : null;
  return gitdirPointerVerdict({ entry, resolvedTarget: parsed, expectedGitdir: EXPECTED });
}

describe("parseGitdirPointer", () => {
  it.each([
    ["gitdir: /repo/.git/worktrees/phase-01\n", "/repo/.git/worktrees/phase-01"],
    ["gitdir: /repo/.git/worktrees/phase-01", "/repo/.git/worktrees/phase-01"],
    ["gitdir: /repo/.git/worktrees/phase-01\r\n", "/repo/.git/worktrees/phase-01"],
    ["gitdir: ./x\n", `${ROOT}/x`],
    ["gitdir: ../../../../repo/.git/worktrees/phase-01\n", "/repo/.git/worktrees/phase-01"],
    ["gitdir: /repo/.git/worktrees/../worktrees/phase-01\n", "/repo/.git/worktrees/phase-01"],
  ])("reads %j as %s", (text, path) => {
    expect(parseGitdirPointer(text, ROOT)).toBe(path);
  });

  it.each([
    "",
    "gitdir:",
    "gitdir: ",
    "gitdir:/repo/.git/worktrees/phase-01",
    "GITDIR: /repo/.git/worktrees/phase-01",
    "gitdir: /repo/.git/worktrees/phase-01\ngitdir: ./x\n",
    "ref: refs/heads/main\n",
  ])("reads %j as no pointer", (text) => {
    expect(parseGitdirPointer(text, ROOT)).toBeNull();
  });
});

describe("gitdirPointerVerdict", () => {
  it.each<[string, GitdirEntry, true | string]>([
    ["a regular file naming the gitdir", file(`gitdir: ${EXPECTED}\n`), true],
    [
      "a relative path to the gitdir",
      file("gitdir: ../../../../repo/.git/worktrees/phase-01"),
      true,
    ],
    ["the gitdir with a trailing slash", file(`gitdir: ${EXPECTED}/\n`), true],
    ["another gitdir", file("gitdir: ./x\n"), "gitdir: ./x"],
    [
      "another registered worktree's gitdir",
      file("gitdir: /repo/.git/worktrees/phase-02\n"),
      "gitdir: /repo/.git/worktrees/phase-02",
    ],
    ["the common gitdir", file("gitdir: /repo/.git\n"), "gitdir: /repo/.git"],
    ["an empty file", file(""), "an empty file"],
    ["a file that is no pointer", file("hello\n"), "hello"],
    ["a directory", { kind: "directory", text: null, linkTarget: null }, "a directory"],
    [
      "a symbolic link, even to the right place",
      { kind: "symlink", text: null, linkTarget: EXPECTED },
      `a symbolic link to ${EXPECTED}`,
    ],
    [
      "a special file",
      { kind: "other", text: null, linkTarget: null },
      "a special file (not a regular file)",
    ],
    ["nothing", { kind: "absent", text: null, linkTarget: null }, "nothing (no .git entry)"],
  ])("%s", (_name, entry, expected) => {
    const verdict = verdictOf(entry);
    if (expected === true) {
      expect(verdict).toEqual({ ok: true });
    } else {
      expect(verdict).toEqual({ ok: false, holds: expected });
    }
  });

  it("shows control characters escaped and cuts long content", () => {
    const verdict = verdictOf(file(`gitdir: ./x\u001b[31m\n${"y".repeat(500)}`));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.holds.startsWith("gitdir: ./x\\x1b[31m\\n")).toBe(true);
      expect(verdict.holds.endsWith("…")).toBe(true);
      expect(verdict.holds.length).toBe(201);
    }
  });
});

describe("renderGitdirPointerRefusal", () => {
  it("names the .git path, what it holds and the expected gitdir", () => {
    expect(
      renderGitdirPointerRefusal({
        dotGitPath: `${ROOT}/.git`,
        holds: "gitdir: ./x",
        expectedGitdir: EXPECTED,
      }),
    ).toBe(
      [
        `${ROOT}/.git: the worktree's .git no longer points at the git directory phax created`,
        ".git holds:  gitdir: ./x",
        `expected:    gitdir: ${EXPECTED}`,
        "phax ran no git command in this worktree after the change.",
      ].join("\n"),
    );
  });
});
