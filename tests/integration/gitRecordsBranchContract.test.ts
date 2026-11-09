import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { Git, type GitError, type GitOps } from "../../src/ports/git.js";
import { decodeBranchName, type BranchName } from "../../src/domain/branded.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const BRANCH: BranchName = Result.getOrThrow(decodeBranchName("phax/records/v1"));
const BRANCH_REF = `refs/heads/${BRANCH}`;
const REMOTE_TRACKING_REF = `refs/remotes/origin/${BRANCH}`;

interface CommitView {
  readonly parent: string | null;
  readonly message: string;
  readonly author: { readonly name: string; readonly email: string; readonly date: string };
}

/** One backend under test: a repository with an `origin` remote, plus setup helpers. */
interface World {
  readonly repo: string;
  run<A>(effect: (git: GitOps) => Effect.Effect<A, GitError>): Promise<A>;
  /** A commit holding exactly `paths`, parented on `parent`; no ref moves. */
  makeCommit(input: {
    parent: string | null;
    paths: readonly string[];
    message?: string;
    author?: CommitView["author"];
  }): string;
  /** Points the remote's records branch at `sha` (null removes it). */
  setRemoteBranch(sha: string | null): void;
  view(sha: string): CommitView;
  teardown(): void;
}

const ORIGINAL_AUTHOR = {
  name: "Ada Original",
  email: "ada@original.test",
  date: "1700000000 +0100",
};

function sh(
  args: readonly string[],
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; input?: string } = {},
) {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...(opts.env !== undefined ? { env: { ...process.env, ...opts.env } } : {}),
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
}

function realWorld(): World {
  const restoreGit = isolateGit();
  const root = mkdtempSync(join(tmpdir(), "phax-git-records-contract-"));
  const remoteDir = join(root, "remote.git");
  const repo = join(root, "repo");
  sh(["init", "--bare", remoteDir], root);
  sh(["init", repo], root);
  for (const dir of [remoteDir, repo]) disableGitAutoMaintenance(dir);
  sh(["config", "--local", "user.name", "Rita Replayer"], repo);
  sh(["config", "--local", "user.email", "rita@replay.test"], repo);
  sh(["remote", "add", "origin", remoteDir], repo);

  return {
    repo,
    run: (effect) => Effect.runPromise(Effect.provide(Effect.flatMap(Git, effect), NodeGitLayer)),
    makeCommit: ({ parent, paths, message = "record\n", author = ORIGINAL_AUTHOR }) => {
      const env = { GIT_INDEX_FILE: join(root, `index-${Math.random().toString(16).slice(2)}`) };
      sh(["read-tree", "--empty"], repo, { env });
      const lines = paths.map((path) => {
        const oid = sh(["hash-object", "-w", "--stdin"], repo, { input: `${path}\n` }).trim();
        return `100644 ${oid}\t${path}`;
      });
      if (lines.length > 0) {
        sh(["update-index", "--index-info"], repo, { env, input: `${lines.join("\n")}\n` });
      }
      const tree = sh(["write-tree"], repo, { env }).trim();
      return sh(
        ["commit-tree", tree, ...(parent === null ? [] : ["-p", parent]), "-F", "-"],
        repo,
        {
          input: message,
          env: {
            GIT_AUTHOR_NAME: author.name,
            GIT_AUTHOR_EMAIL: author.email,
            GIT_AUTHOR_DATE: author.date,
          },
        },
      ).trim();
    },
    setRemoteBranch: (sha) => {
      if (sha === null) sh(["push", "origin", "--delete", BRANCH], repo);
      else sh(["push", "origin", `${sha}:refs/heads/${BRANCH}`], repo);
    },
    view: (sha) => {
      const raw = sh(["cat-file", "commit", sha], repo);
      const split = raw.indexOf("\n\n");
      const header = raw.slice(0, split);
      const author = /^author (.*) <(.*)> (\d+ [+-]\d{4})$/m.exec(header)!;
      return {
        parent: /^parent (.*)$/m.exec(header)?.[1] ?? null,
        message: raw.slice(split + 2),
        author: { name: author[1]!, email: author[2]!, date: author[3]! },
      };
    },
    teardown: () => {
      removeTempDir(root);
      restoreGit();
    },
  };
}

function fakeWorld(): World {
  const fake = makeFakeGit();
  const repo = "/fake/repo";
  return {
    repo,
    run: (effect) => Effect.runPromise(effect(fake.impl)),
    makeCommit: ({ parent, paths, message = "record\n", author = ORIGINAL_AUTHOR }) =>
      fake.impl.addFakeCommit({ parent, paths, message, author }),
    setRemoteBranch: (sha) => fake.impl.setRemoteBranch("origin", BRANCH, sha),
    view: (sha) => {
      const commit = fake.impl.fakeCommits.get(sha)!;
      return { parent: commit.parent, message: commit.message, author: commit.author };
    },
    teardown: () => undefined,
  };
}

describe.each([
  ["real git adapter", realWorld],
  ["fake git", fakeWorld],
] as const)("records branch Git port contract: %s", (_name, makeWorld) => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    world.teardown();
  });

  describe("mergeBase", () => {
    it("is the ancestor when one tip contains the other", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["b/record.json"] });
      expect(await world.run((g) => g.mergeBase(world.repo, c1, c2))).toBe(c1);
      expect(await world.run((g) => g.mergeBase(world.repo, c2, c1))).toBe(c1);
    });

    it("is the fork point when the tips diverged", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      const left = world.makeCommit({ parent: c1, paths: ["l/record.json"] });
      const right = world.makeCommit({ parent: c1, paths: ["r/record.json"] });
      expect(await world.run((g) => g.mergeBase(world.repo, left, right))).toBe(c1);
    });

    it("is null when the tips share no commit", async () => {
      const one = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      const other = world.makeCommit({ parent: null, paths: ["b/record.json"] });
      expect(await world.run((g) => g.mergeBase(world.repo, one, other))).toBeNull();
    });
  });

  describe("listCommitFiles", () => {
    it("lists every commit oldest first, each with its own paths", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["k1/record.json", "k1/prompt.md"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["k2/record.json"] });
      const c3 = world.makeCommit({ parent: c2, paths: ["k3/record.json"] });
      const listed = await world.run((g) => g.listCommitFiles(world.repo, c3, null));
      expect(listed.map((c) => c.sha)).toEqual([c1, c2, c3]);
      expect(listed[0]!.paths.toSorted()).toEqual(["k1/prompt.md", "k1/record.json"]);
      expect(listed[1]!.paths).toEqual(["k2/record.json"]);
      expect(listed[2]!.paths).toEqual(["k3/record.json"]);
    });

    it("lists a commit's whole tree and its tree id, even a tree identical to its parent's", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["review/r1/record.json"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["review/r1/record.json"] });
      const listed = await world.run((g) => g.listCommitFiles(world.repo, c2, null));
      expect(listed.map((c) => c.paths)).toEqual([
        ["review/r1/record.json"],
        ["review/r1/record.json"],
      ]);
      expect(listed[0]!.tree).toBe(listed[1]!.tree);
      expect(listed[0]!.tree).toMatch(/\S/);
    });

    it("leaves out what the excluded commit reaches", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["k1/record.json"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["k2/record.json"] });
      const c3 = world.makeCommit({ parent: c2, paths: ["k3/record.json"] });
      const listed = await world.run((g) => g.listCommitFiles(world.repo, c3, c1));
      expect(listed.map((c) => c.sha)).toEqual([c2, c3]);
      expect(await world.run((g) => g.listCommitFiles(world.repo, c3, c3))).toEqual([]);
    });
  });

  describe("recommit", () => {
    it("keeps tree, message bytes and author; only the parent and sha change", async () => {
      const message = "records(phase-01): committed\n\nRun-Id: r1\n  indented  \n\n\ntrailing\n";
      const original = world.makeCommit({
        parent: null,
        paths: ["k1/record.json", "k1/prompt.md"],
        message,
      });
      const newBase = world.makeCommit({ parent: null, paths: ["base/record.json"] });

      const replayed = await world.run((g) => g.recommit(world.repo, original, newBase));

      expect(replayed).not.toBe(original);
      const before = world.view(original);
      const after = world.view(replayed);
      expect(after.parent).toBe(newBase);
      expect(after.message).toBe(before.message);
      expect(after.message).toBe(message);
      expect(after.author).toEqual(before.author);
      const [listed] = await world.run((g) => g.listCommitFiles(world.repo, replayed, newBase));
      expect(listed!.paths.toSorted()).toEqual(["k1/prompt.md", "k1/record.json"]);
    });

    it("moves no ref", async () => {
      const original = world.makeCommit({ parent: null, paths: ["k1/record.json"] });
      const base = world.makeCommit({ parent: null, paths: ["base/record.json"] });
      await world.run((g) => g.recommit(world.repo, original, base));
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBeNull();
    });
  });

  describe("updateRef", () => {
    it("creates a ref that does not exist and moves it from its expected value", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["b/record.json"] });
      await world.run((g) => g.updateRef(world.repo, BRANCH_REF, c1, null));
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBe(c1);
      await world.run((g) => g.updateRef(world.repo, BRANCH_REF, c2, c1));
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBe(c2);
    });

    it("refuses a stale expected tip and leaves the ref where it was", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["b/record.json"] });
      const c3 = world.makeCommit({ parent: c2, paths: ["c/record.json"] });
      await world.run((g) => g.updateRef(world.repo, BRANCH_REF, c2, null));

      const stale = await world.run((g) =>
        Effect.result(g.updateRef(world.repo, BRANCH_REF, c3, c1)),
      );

      expect(Result.isFailure(stale)).toBe(true);
      if (Result.isFailure(stale)) expect(stale.left.command).toContain("update-ref");
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBe(c2);
    });

    it("refuses to create a ref that already exists", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["b/record.json"] });
      await world.run((g) => g.updateRef(world.repo, BRANCH_REF, c1, null));

      const created = await world.run((g) =>
        Effect.result(g.updateRef(world.repo, BRANCH_REF, c2, null)),
      );

      expect(Result.isFailure(created)).toBe(true);
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBe(c1);
    });
  });

  describe("writeTreeCommit", () => {
    const files = [{ path: "k1/record.json", content: new TextEncoder().encode("{}\n") }];

    it("parents on the given parent and creates the branch from a null expected tip", async () => {
      const base = world.makeCommit({ parent: null, paths: ["base/record.json"] });
      const written = await world.run((g) =>
        g.writeTreeCommit({
          repo: world.repo,
          branch: BRANCH,
          message: "records(phase-01): committed",
          files,
          parent: base,
          expectedTip: null,
        }),
      );
      expect(world.view(written).parent).toBe(base);
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBe(written);
    });

    it("refuses to move the branch from a stale expected tip", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      await world.run((g) => g.updateRef(world.repo, BRANCH_REF, c1, null));

      const attempt = await world.run((g) =>
        Effect.result(
          g.writeTreeCommit({
            repo: world.repo,
            branch: BRANCH,
            message: "records(phase-01): committed",
            files,
            parent: c1,
            expectedTip: null,
          }),
        ),
      );

      expect(Result.isFailure(attempt)).toBe(true);
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBe(c1);
    });
  });

  describe("fetchBranch", () => {
    it("answers absent when the remote has no such branch", async () => {
      const answer = await world.run((g) => g.fetchBranch(world.repo, "origin", BRANCH));
      expect(answer).toBe("absent");
      expect(await world.run((g) => g.resolveRef(world.repo, REMOTE_TRACKING_REF))).toBeNull();
    });

    it("fetches the branch into its remote-tracking ref and answers fetched", async () => {
      const c1 = world.makeCommit({ parent: null, paths: ["a/record.json"] });
      const c2 = world.makeCommit({ parent: c1, paths: ["b/record.json"] });
      world.setRemoteBranch(c2);

      const answer = await world.run((g) => g.fetchBranch(world.repo, "origin", BRANCH));

      expect(answer).toBe("fetched");
      expect(await world.run((g) => g.resolveRef(world.repo, REMOTE_TRACKING_REF))).toBe(c2);
      // The local branch is not touched by a fetch.
      expect(await world.run((g) => g.resolveRef(world.repo, BRANCH_REF))).toBeNull();
    });
  });
});

describe("listCommitFiles under a user's git config", () => {
  let world: World;
  beforeEach(() => {
    world = realWorld();
  });
  afterEach(() => world.teardown());

  it("lists a root commit's paths and non-ASCII keys with log.showRoot=false and core.quotePath=true", async () => {
    sh(["config", "--local", "log.showRoot", "false"], world.repo);
    sh(["config", "--local", "core.quotePath", "true"], world.repo);
    sh(["config", "--local", "log.showSignature", "true"], world.repo);
    const c1 = world.makeCommit({ parent: null, paths: ["clé-1/record.json"] });
    const c2 = world.makeCommit({ parent: c1, paths: ["k2/record.json"] });

    const listed = await world.run((g) => g.listCommitFiles(world.repo, c2, null));

    expect(listed.map((c) => c.sha)).toEqual([c1, c2]);
    expect(listed[0]!.paths).toEqual(["clé-1/record.json"]);
    expect(listed[1]!.paths).toEqual(["k2/record.json"]);
  });
});
