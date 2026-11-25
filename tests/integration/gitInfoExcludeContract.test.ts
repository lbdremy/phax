import { Effect, Layer, Result } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeBranchName,
  decodeWorktreePath,
  type WorktreePath,
} from "../../src/domain/branded.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeNodeGitLayer, NodeGitLayer } from "../../src/infra/git.js";
import { Git, type GitOps } from "../../src/ports/git.js";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// One suite, run against the fake and the real git adapter: ensureInfoExclude
// appends its line once, a second call adds nothing, and the path is then
// ignored in a linked worktree of the repository.

const LINE = "/.phax-context";
const BRANCH = Result.getOrThrow(decodeBranchName("phax/invoice-export--phase-01"));
const worktreePath = (path: string): WorktreePath => Result.getOrThrow(decodeWorktreePath(path));

interface World {
  readonly repo: string;
  readonly worktree: WorktreePath;
  readonly layer: Layer.Layer<Git>;
}

const withGit = <A>(world: World, f: (git: GitOps) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(Git, f).pipe(Effect.provide(world.layer)));

let restoreGit: () => void = () => {};
let root: string | undefined;

beforeEach(() => {
  restoreGit = isolateGit();
});

afterEach(() => {
  removeTempDir(root);
  root = undefined;
  restoreGit();
});

const gitIn = (cwd: string, ...args: string[]): string =>
  boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd });

// A repository with one commit and the phase branch; no worktree yet.
function realRepo(): string {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-info-exclude-")));
  const repo = join(root, "repo");
  mkdirSync(repo);
  gitIn(repo, "init", "--initial-branch=main");
  disableGitAutoMaintenance(repo);
  gitIn(repo, "config", "--local", "user.email", "ada@example.test");
  gitIn(repo, "config", "--local", "user.name", "Ada Example");
  gitIn(repo, "config", "--local", "commit.gpgsign", "false");
  writeFileSync(join(repo, "keep.ts"), "export const keep = 1;\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-m", "chore: start");
  gitIn(repo, "branch", BRANCH);
  return repo;
}

async function nodeWorld(): Promise<World> {
  const repo = realRepo();
  const world: World = {
    repo,
    worktree: worktreePath(join(repo, "..", "worktrees", "phase-01")),
    layer: makeNodeGitLayer({ repoRoot: repo }),
  };
  await withGit(world, (git) => git.addWorktree(BRANCH, world.worktree, repo));
  return world;
}

async function fakeWorld(): Promise<World> {
  const fake = makeFakeGit();
  const world: World = {
    repo: "/repo",
    worktree: worktreePath("/state/worktrees/phase-01"),
    layer: fake.layer,
  };
  await withGit(world, (git) => git.addWorktree(BRANCH, world.worktree, world.repo));
  return world;
}

describe.each([
  ["fake", fakeWorld],
  ["node", nodeWorld],
])("Git.ensureInfoExclude (%s)", (_name, make) => {
  it("appends the line once, then ignores the path in a linked worktree", async () => {
    const world = await make();
    await expect(
      withGit(world, (git) => git.isIgnored(world.worktree, ".phax-context")),
    ).resolves.toBe(false);
    await expect(withGit(world, (git) => git.ensureInfoExclude(world.repo, LINE))).resolves.toBe(
      true,
    );
    await expect(withGit(world, (git) => git.ensureInfoExclude(world.repo, LINE))).resolves.toBe(
      false,
    );
    await expect(
      withGit(world, (git) => git.isIgnored(world.worktree, ".phax-context")),
    ).resolves.toBe(true);
  });
});

describe("Git.ensureInfoExclude (node, on disk)", () => {
  it("writes exactly one line into the common dir's info/exclude, created when missing", async () => {
    const world = await nodeWorld();
    const exclude = join(world.repo, ".git", "info", "exclude");
    removeTempDir(join(world.repo, ".git", "info"));
    await withGit(world, (git) => git.ensureInfoExclude(world.repo, LINE));
    await withGit(world, (git) => git.ensureInfoExclude(world.repo, LINE));
    expect(readFileSync(exclude, "utf8")).toBe(`${LINE}\n`);
  });

  it("keeps the existing lines and ends an unterminated last line before its own", async () => {
    const world = await nodeWorld();
    const exclude = join(world.repo, ".git", "info", "exclude");
    writeFileSync(exclude, "# local\n/.phax-context/\n*.log");
    await expect(withGit(world, (git) => git.ensureInfoExclude(world.repo, LINE))).resolves.toBe(
      true,
    );
    expect(readFileSync(exclude, "utf8")).toBe(`# local\n/.phax-context/\n*.log\n${LINE}\n`);
  });

  it("finds the common dir's file when called with the repository-less layer", async () => {
    const world = await nodeWorld();
    await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.ensureInfoExclude(world.repo, LINE)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );
    expect(readFileSync(join(world.repo, ".git", "info", "exclude"), "utf8")).toContain(
      `\n${LINE}\n`,
    );
    expect(gitIn(world.worktree, "check-ignore", "-v", ".phax-context")).toContain("info/exclude");
  });
});
