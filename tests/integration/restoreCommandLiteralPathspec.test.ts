import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildResumeInstructions } from "../../src/app/resumeInstructions.js";
import { boundedOutput, GIT_BOUND_MS } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// SEC-30: a changed protected path named like pathspec magic. The pasted restore
// command must read it as a file name and leave the rest of the worktree alone.
const MAGIC = ":(exclude)x";
const SIBLING = "work.txt";

let restoreGit: () => void;
let home: string;
let repo: string;
let savedHome: string | undefined;

const git = (...args: string[]): string =>
  boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd: repo }).trim();

const write = (path: string, text: string): void => writeFileSync(join(repo, path), text);
const read = (path: string): string => readFileSync(join(repo, path), "utf8");

/** Run one printed command line in the worktree, as a person who pastes it does. */
const paste = (command: string): void => {
  boundedOutput("sh", ["-c", command], { boundMs: GIT_BOUND_MS, cwd: repo });
};

/** The restore command resume-instructions.md prints for the edited magic path. */
function printedRestoreCommand(commit: string): string {
  const md = buildResumeInstructions({
    runPath: "/runs/my-run",
    shortName: "my-run",
    reason: "Protected paths changed after the commit",
    kind: "protected_paths_changed",
    phaseId: "phase-01",
    protectedChanges: [{ path: MAGIC, kind: "edited", entry: "protectedPaths[0]", glob: "**/*x" }],
    protectedRestore: { commit, name: "phase commit" },
    now: new Date("2026-06-19T12:00:00.000Z"),
    platform: "linux",
  });
  const line = md.split("\n").find((l) => l.startsWith("git "));
  if (line === undefined) throw new Error(`no restore command in:\n${md}`);
  return line;
}

beforeEach(() => {
  restoreGit = isolateGit();
  savedHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "phax-restore-home-"));
  process.env["HOME"] = home;
  repo = mkdtempSync(join(tmpdir(), "phax-restore-repo-"));
  git("init", "--quiet");
  disableGitAutoMaintenance(repo);
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  write(MAGIC, "committed\n");
  write(SIBLING, "committed\n");
  git("--literal-pathspecs", "add", "--", MAGIC, SIBLING);
  git("commit", "--quiet", "-m", "base");
  write(MAGIC, "changed\n");
  write(SIBLING, "the phase's work\n");
});

afterEach(() => {
  if (savedHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = savedHome;
  restoreGit();
  removeTempDir(repo);
  removeTempDir(home);
});

describe("the printed restore command of a protected path named like pathspec magic", () => {
  it("restores only that file and keeps the rest of the worktree", () => {
    paste(printedRestoreCommand(git("rev-parse", "HEAD")));

    expect(read(MAGIC)).toBe("committed\n");
    expect(read(SIBLING)).toBe("the phase's work\n");
  });

  it("differs from the old form, which discards the other file's change", () => {
    paste(`git checkout ${git("rev-parse", "HEAD")} -- '${MAGIC}'`);

    // `:(exclude)x` reads as "everything but x": the whole tree is checked out.
    expect(read(SIBLING)).toBe("committed\n");
  });
});
