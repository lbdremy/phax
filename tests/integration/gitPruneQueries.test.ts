import { writeFile } from "node:fs/promises";
import { mkdtempSync, realpathSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, type GitOps } from "../../src/ports/git.js";
import type { BranchName } from "../../src/domain/branded.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, stdio: "pipe" }).toString();
}

const withGit = <A>(f: (ops: GitOps) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(Git, f).pipe(Effect.provide(NodeGitLayer)));

const branch = (name: string): BranchName => name as BranchName;

// macOS hands out /var/... temp paths that git reports as /private/var/...,
// so every temp dir is realpath'd before git ever sees it.
function makeTempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

let repoDir: string;
let scratchDir: string;

beforeEach(async () => {
  repoDir = makeTempDir("phax-git-prune-queries-test-");
  scratchDir = makeTempDir("phax-git-prune-queries-scratch-");
  git(["init", "--initial-branch=main"], repoDir);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.email", "test@phax.test"], repoDir);
  git(["config", "--local", "user.name", "phax test"], repoDir);
  await writeFile(join(repoDir, "README.md"), "# test\n");
  git(["add", "."], repoDir);
  git(["commit", "-m", "chore: initial commit"], repoDir);
});

afterEach(() => {
  removeTempDir(repoDir);
  removeTempDir(scratchDir);
});

// A commit that only `phax/x--phase-02` holds: branch off main, commit, return to main.
async function commitOnlyOn(name: string): Promise<string> {
  git(["switch", "-c", name], repoDir);
  await writeFile(join(repoDir, `${name.replaceAll("/", "_")}.txt`), "work\n");
  git(["add", "."], repoDir);
  git(["commit", "-m", `feat: work on ${name}`], repoDir);
  const sha = git(["rev-parse", "HEAD"], repoDir).trim();
  git(["switch", "main"], repoDir);
  return sha;
}

describe("NodeGitLayer.listRefs", () => {
  it("returns sorted full ref names under the prefix, remote-tracking refs included", async () => {
    git(["branch", "phax/x"], repoDir);
    git(["update-ref", "refs/remotes/origin/phax/x", "HEAD"], repoDir);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"], repoDir);

    const heads = await withGit((ops) => ops.listRefs(repoDir, "refs/heads/"));
    expect(heads).toEqual(["refs/heads/main", "refs/heads/phax/x"]);

    const remotes = await withGit((ops) => ops.listRefs(repoDir, "refs/remotes/"));
    expect(remotes).toEqual(["refs/remotes/origin/main", "refs/remotes/origin/phax/x"]);
  });
});

describe("NodeGitLayer.countUnpreservedCommits", () => {
  const phase02 = branch("phax/x--phase-02");

  it("counts a commit held only by the branch", async () => {
    await commitOnlyOn(phase02);
    const count = await withGit((ops) => ops.countUnpreservedCommits(repoDir, phase02, [phase02]));
    expect(count).toBe(1);
  });

  it("still counts it when a sibling that also reaches it is being deleted", async () => {
    await commitOnlyOn(phase02);
    git(["branch", "phax/x--phase-01", phase02], repoDir);
    const count = await withGit((ops) =>
      ops.countUnpreservedCommits(repoDir, phase02, [branch("phax/x--phase-01"), phase02]),
    );
    expect(count).toBe(1);
  });

  it("counts 0 when a tag reaches the commit", async () => {
    await commitOnlyOn(phase02);
    git(["tag", "keep-me", phase02], repoDir);
    const count = await withGit((ops) => ops.countUnpreservedCommits(repoDir, phase02, [phase02]));
    expect(count).toBe(0);
  });

  it("counts 0 when a remote-tracking ref reaches the commit", async () => {
    const sha = await commitOnlyOn(phase02);
    git(["update-ref", "refs/remotes/origin/phax/x--phase-02", sha], repoDir);
    const count = await withGit((ops) => ops.countUnpreservedCommits(repoDir, phase02, [phase02]));
    expect(count).toBe(0);
  });

  it("counts 0 when an unrelated branch reaches the commit", async () => {
    await commitOnlyOn(phase02);
    git(["branch", "feature/unrelated", phase02], repoDir);
    const count = await withGit((ops) => ops.countUnpreservedCommits(repoDir, phase02, [phase02]));
    expect(count).toBe(0);
  });

  it("counts 0 for a branch fully merged into main", async () => {
    await commitOnlyOn(phase02);
    git(["merge", "--ff-only", phase02], repoDir);
    const count = await withGit((ops) => ops.countUnpreservedCommits(repoDir, phase02, [phase02]));
    expect(count).toBe(0);
  });
});

describe("NodeGitLayer.listWorktrees", () => {
  it("reports a linked worktree's path and branch", async () => {
    git(["branch", "phax/x--phase-01"], repoDir);
    const wtPath = join(scratchDir, "phase-01");
    git(["worktree", "add", wtPath, "phax/x--phase-01"], repoDir);

    const entries = await withGit((ops) => ops.listWorktrees(repoDir));
    expect(entries).toEqual([
      { path: repoDir, branch: "main", prunable: false },
      { path: wtPath, branch: "phax/x--phase-01", prunable: false },
    ]);
  });

  it("reports a worktree whose folder was moved away as prunable", async () => {
    git(["branch", "phax/x--phase-01"], repoDir);
    const wtPath = join(scratchDir, "phase-01");
    git(["worktree", "add", wtPath, "phax/x--phase-01"], repoDir);
    renameSync(wtPath, join(scratchDir, "moved"));

    const entries = await withGit((ops) => ops.listWorktrees(repoDir));
    expect(entries).toContainEqual({ path: wtPath, branch: "phax/x--phase-01", prunable: true });
  });
});
