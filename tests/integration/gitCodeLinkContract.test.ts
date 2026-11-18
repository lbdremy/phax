import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { Git, type GitError, type GitOps } from "../../src/ports/git.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { removeTempDir } from "../helpers/tempGit.js";

/** One backend under test, set up with the same facts as the other. */
interface World {
  /** A repository root. */
  readonly repo: string;
  /** A nested repository at `<repo>/code`. */
  readonly nested: string;
  /** A plain subdirectory of `repo`. */
  readonly sub: string;
  /** A directory in no repository. */
  readonly outside: string;
  readonly missing: string;
  run<A>(effect: (git: GitOps) => Effect.Effect<A, GitError>): Promise<A>;
  teardown(): void;
}

function sh(args: readonly string[], cwd: string): void {
  execFileSync("git", [...args], { cwd, stdio: "pipe" });
}

/** `ignoreRules` is the repository's .gitignore; `code` and `visible` are directories of it. */
function realWorld(ignoreRules: string): World {
  const restoreGit = isolateGit();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-git-codelink-contract-")));
  const repo = join(root, "repo");
  const nested = join(repo, "code");
  const sub = join(repo, "sub");
  const outside = join(root, "outside");
  for (const dir of [repo, nested, sub, outside, join(repo, "visible")]) {
    mkdirSync(dir, { recursive: true });
  }
  sh(["init"], repo);
  sh(["init"], nested);
  writeFileSync(join(repo, ".gitignore"), ignoreRules);
  return {
    repo,
    nested,
    sub,
    outside,
    missing: join(root, "missing"),
    run: (effect) => Effect.runPromise(Effect.provide(Effect.flatMap(Git, effect), NodeGitLayer)),
    teardown: () => {
      removeTempDir(root);
      restoreGit();
    },
  };
}

function fakeWorld(ignoreRules: string): World {
  const fake = makeFakeGit();
  const repo = "/fake/repo";
  const nested = `${repo}/code`;
  const sub = `${repo}/sub`;
  fake.impl.setRepoTopLevel(repo, repo);
  fake.impl.setRepoTopLevel(sub, repo);
  fake.impl.setRepoTopLevel(nested, nested);
  fake.impl.setIgnored(repo, "code", /^\/?code\/$/m.test(ignoreRules));
  return {
    repo,
    nested,
    sub,
    outside: "/fake/outside",
    missing: "/fake/missing",
    run: (effect) => Effect.runPromise(effect(fake.impl)),
    teardown: () => undefined,
  };
}

describe.each([
  ["real git adapter", realWorld],
  ["fake git", fakeWorld],
] as const)("code link Git port contract: %s", (_name, makeWorld) => {
  let world: World;

  afterEach(() => {
    world.teardown();
  });

  describe("repoTopLevel", () => {
    beforeEach(() => {
      world = makeWorld("/code/\n");
    });

    it("is a repository's root for its root and for a subdirectory", async () => {
      expect(await world.run((g) => g.repoTopLevel(world.repo))).toBe(world.repo);
      expect(await world.run((g) => g.repoTopLevel(world.sub))).toBe(world.repo);
    });

    it("is a nested repository's own root", async () => {
      expect(await world.run((g) => g.repoTopLevel(world.nested))).toBe(world.nested);
    });

    it("is null for a missing path and for a directory in no repository", async () => {
      expect(await world.run((g) => g.repoTopLevel(world.missing))).toBeNull();
      expect(await world.run((g) => g.repoTopLevel(world.outside))).toBeNull();
    });
  });

  describe("isIgnored", () => {
    it("is true for a directory ignored by /code/", async () => {
      world = makeWorld("/code/\n");
      expect(await world.run((g) => g.isIgnored(world.repo, "code"))).toBe(true);
    });

    it("is true for a directory ignored by code/", async () => {
      world = makeWorld("code/\n");
      expect(await world.run((g) => g.isIgnored(world.repo, "code"))).toBe(true);
    });

    it("is false for a directory that is not ignored", async () => {
      world = makeWorld("/code/\n");
      expect(await world.run((g) => g.isIgnored(world.repo, "visible"))).toBe(false);
    });

    it("is false when nothing ignores the directory", async () => {
      world = makeWorld("");
      expect(await world.run((g) => g.isIgnored(world.repo, "code"))).toBe(false);
    });
  });
});
