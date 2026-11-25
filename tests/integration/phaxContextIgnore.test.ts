import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPhaseWorktree, writePhasePlanFile } from "../../src/app/worktree.js";
import {
  decodeBranchName,
  decodePhaseId,
  decodeShortName,
  type WorktreePath,
} from "../../src/domain/branded.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeNodeGitLayer } from "../../src/infra/git.js";
import { Git } from "../../src/ports/git.js";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// phax keeps `.phax-context` out of git through the repository's
// info/exclude, never through the worktree's .gitignore: in a repository with
// no .gitignore, the phase commit carries no ignore line and no phax metadata,
// and a `.phax-context` link the agent makes is not committed either.

const NAMESPACE = "example";
const SHORT = "invoice-export";

let root: string;
let repoRoot: string;
let stateRoot: string;
let outside: string;
let restoreGit: () => void;

const gitIn = (cwd: string, ...args: string[]): string =>
  boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd });

const writeIn = (dir: string, path: string, content: string): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};

beforeEach(() => {
  restoreGit = isolateGit();
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-context-ignore-")));
  repoRoot = join(root, "repo");
  stateRoot = join(root, "state");
  outside = join(root, "outside");
  for (const dir of [repoRoot, stateRoot, outside]) mkdirSync(dir);
  gitIn(repoRoot, "init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  gitIn(repoRoot, "config", "--local", "user.email", "ada@example.test");
  gitIn(repoRoot, "config", "--local", "user.name", "Ada Example");
  gitIn(repoRoot, "config", "--local", "commit.gpgsign", "false");
  // No .gitignore anywhere in the repository.
  writeIn(repoRoot, "src/keep.ts", "export const keep = 1;\n");
  gitIn(repoRoot, "add", "-A");
  gitIn(repoRoot, "commit", "-m", "chore: start");
  gitIn(repoRoot, "branch", `phax/${SHORT}--phase-01`, "main");
});

afterEach(() => {
  removeTempDir(root);
  restoreGit();
});

const layers = () => Layer.mergeAll(NodeFileSystemLayer, makeNodeGitLayer({ repoRoot }));

async function preparedWorktree(): Promise<WorktreePath> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const worktree = yield* createPhaseWorktree(
        NAMESPACE,
        Result.getOrThrow(decodeShortName(SHORT)),
        Result.getOrThrow(decodePhaseId("phase-01")),
        Result.getOrThrow(decodeBranchName(`phax/${SHORT}--phase-01`)),
        stateRoot,
        repoRoot,
      );
      yield* writePhasePlanFile(worktree, "# The plan\n");
      return worktree;
    }).pipe(Effect.provide(layers())),
  );
}

// phax's own phase commit: stage everything, as `git add -A` does, and commit.
function commitPhase(worktree: string): Promise<void> {
  return Effect.runPromise(
    Effect.flatMap(Git, (git) => git.commit(worktree, "feat(export): step one", "Body.")).pipe(
      Effect.provide(layers()),
    ),
  );
}

const committedPaths = (worktree: string): string[] =>
  gitIn(worktree, "show", "--name-only", "--format=", "HEAD").trim().split("\n");

const treePaths = (worktree: string): string[] =>
  gitIn(worktree, "ls-tree", "-r", "--name-only", "HEAD").trim().split("\n");

describe("the ignore rule for .phax-context", () => {
  it("adds no .gitignore and no .phax-context entry to the phase commit, and comes from info/exclude", async () => {
    const worktree = await preparedWorktree();
    expect(existsSync(join(worktree, ".gitignore"))).toBe(false);
    // The agent's work, and its metadata beside phax's plan.
    writeIn(worktree, "src/phase-01.ts", "export const one = 1;\n");
    writeIn(worktree, ".phax-context/phase-handoff.md", "## What was delivered\n");
    gitIn(worktree, "add", "-A");

    await commitPhase(worktree);

    expect(committedPaths(worktree)).toEqual(["src/phase-01.ts"]);
    expect(treePaths(worktree)).toEqual(["src/keep.ts", "src/phase-01.ts"]);
    const source = gitIn(worktree, "check-ignore", "-v", ".phax-context");
    expect(source).toMatch(/info\/exclude:\d+:\/\.phax-context\t\.phax-context/);
  });

  it("keeps a .phax-context link the agent made in a fresh worktree out of phax's commit", async () => {
    const worktree = await preparedWorktree();
    writeIn(worktree, "src/phase-01.ts", "export const one = 1;\n");
    rmSync(join(worktree, ".phax-context"), { recursive: true, force: true });
    symlinkSync(outside, join(worktree, ".phax-context"));
    gitIn(worktree, "add", "-A");

    await commitPhase(worktree);

    expect(committedPaths(worktree)).toEqual(["src/phase-01.ts"]);
    expect(treePaths(worktree)).not.toContain(".phax-context");
  });
});
