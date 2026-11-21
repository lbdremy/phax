import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { Git, type GitError, type GitOps } from "../../src/ports/git.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

/** One backend under test, plus a setup helper. */
interface World {
  readonly repo: string;
  run<A>(effect: (git: GitOps) => Effect.Effect<A, GitError>): Promise<A>;
  /**
   * A commit whose tree holds exactly `files` (path to content), parented on
   * `parents`. `expected` is what the fake is told the commit changes.
   */
  makeCommit(input: {
    parents: readonly string[];
    files: Readonly<Record<string, string>>;
    expected: readonly string[];
  }): string;
  teardown(): void;
}

function sh(
  args: readonly string[],
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; input?: string } = {},
) {
  return boundedOutput("git", [...args], {
    boundMs: GIT_BOUND_MS,
    cwd,
    ...(opts.env !== undefined ? { env: { ...process.env, ...opts.env } } : {}),
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
}

function realWorld(): World {
  const restoreGit = isolateGit();
  const root = mkdtempSync(join(tmpdir(), "phax-git-changed-paths-"));
  const repo = join(root, "repo");
  sh(["init", repo], root);
  disableGitAutoMaintenance(repo);
  sh(["config", "--local", "user.name", "Rita Replayer"], repo);
  sh(["config", "--local", "user.email", "rita@replay.test"], repo);
  return {
    repo,
    run: (effect) => Effect.runPromise(Effect.provide(Effect.flatMap(Git, effect), NodeGitLayer)),
    makeCommit: ({ parents, files }) => {
      const env = { GIT_INDEX_FILE: join(root, `index-${Math.random().toString(16).slice(2)}`) };
      sh(["read-tree", "--empty"], repo, { env });
      const lines = Object.entries(files).map(([path, content]) => {
        const oid = sh(["hash-object", "-w", "--stdin"], repo, { input: content }).trim();
        return `100644 ${oid}\t${path}`;
      });
      if (lines.length > 0) {
        sh(["update-index", "--index-info"], repo, { env, input: `${lines.join("\n")}\n` });
      }
      const tree = sh(["write-tree"], repo, { env }).trim();
      return sh(
        ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", "change"],
        repo,
      ).trim();
    },
    teardown: () => {
      removeTempDir(root);
      restoreGit();
    },
  };
}

function fakeWorld(): World {
  const fake = makeFakeGit();
  return {
    repo: "/fake/repo",
    run: (effect) => Effect.runPromise(effect(fake.impl)),
    makeCommit: ({ parents, files, expected }) => {
      const sha = fake.impl.addFakeCommit({
        parent: parents[0] ?? null,
        paths: Object.keys(files),
      });
      fake.impl.setCommitChangedPaths(sha, expected);
      return sha;
    },
    teardown: () => undefined,
  };
}

describe.each([
  ["real git adapter", realWorld],
  ["fake git", fakeWorld],
] as const)("commitChangedPaths Git port contract: %s", (_name, makeWorld) => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    world.teardown();
  });

  const changed = (sha: string) => world.run((g) => g.commitChangedPaths(world.repo, sha));

  it("lists a modified file and an added one, sorted", async () => {
    const root = world.makeCommit({
      parents: [],
      files: { "a.ts": "1\n", "keep.ts": "k\n" },
      expected: ["a.ts", "keep.ts"],
    });
    const next = world.makeCommit({
      parents: [root],
      files: { "a.ts": "2\n", "keep.ts": "k\n", "b/new.ts": "n\n" },
      expected: ["a.ts", "b/new.ts"],
    });
    expect(await changed(next)).toEqual(["a.ts", "b/new.ts"]);
  });

  it("lists a deletion", async () => {
    const root = world.makeCommit({
      parents: [],
      files: { "a.ts": "1\n", "gone.ts": "g\n" },
      expected: ["a.ts", "gone.ts"],
    });
    const next = world.makeCommit({
      parents: [root],
      files: { "a.ts": "1\n" },
      expected: ["gone.ts"],
    });
    expect(await changed(next)).toEqual(["gone.ts"]);
  });

  it("lists both paths of a rename", async () => {
    const root = world.makeCommit({
      parents: [],
      files: { "old.ts": "same content\n" },
      expected: ["old.ts"],
    });
    const next = world.makeCommit({
      parents: [root],
      files: { "new.ts": "same content\n" },
      expected: ["new.ts", "old.ts"],
    });
    expect(await changed(next)).toEqual(["new.ts", "old.ts"]);
  });

  it("lists every path of a root commit", async () => {
    const root = world.makeCommit({
      parents: [],
      files: { "a.ts": "1\n", "d/b.ts": "2\n" },
      expected: ["a.ts", "d/b.ts"],
    });
    expect(await changed(root)).toEqual(["a.ts", "d/b.ts"]);
  });

  it("diffs a merge commit against its first parent only", async () => {
    const base = world.makeCommit({ parents: [], files: { "a.ts": "1\n" }, expected: ["a.ts"] });
    const left = world.makeCommit({
      parents: [base],
      files: { "a.ts": "1\n", "left.ts": "l\n" },
      expected: ["left.ts"],
    });
    const right = world.makeCommit({
      parents: [base],
      files: { "a.ts": "1\n", "right.ts": "r\n" },
      expected: ["right.ts"],
    });
    const merge = world.makeCommit({
      parents: [left, right],
      files: { "a.ts": "1\n", "left.ts": "l\n", "right.ts": "r\n" },
      expected: ["right.ts"],
    });
    expect(await changed(merge)).toEqual(["right.ts"]);
  });

  it("never quotes a path with a space or a non-ASCII character", async () => {
    const root = world.makeCommit({
      parents: [],
      files: { "dir with space/café é.ts": "1\n" },
      expected: ["dir with space/café é.ts"],
    });
    expect(await changed(root)).toEqual(["dir with space/café é.ts"]);
  });

  it("refuses an unknown sha with a GitError", async () => {
    const result = await world.run((g) =>
      Effect.result(g.commitChangedPaths(world.repo, "0123456789abcdef0123456789abcdef01234567")),
    );
    expect(Result.isFailure(result)).toBe(true);
  });
});
