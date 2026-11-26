import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { createHash } from "node:crypto";
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

interface CommitInput {
  readonly parents: readonly string[];
  /** The commit's whole tree: path to content. */
  readonly files: Readonly<Record<string, string>>;
  readonly message: string;
  /** Committer and author instant, strict ISO-8601 as `%cI` prints it. */
  readonly date: string;
}

/** One backend under test, plus a setup helper. */
interface World {
  readonly repo: string;
  run<A>(effect: (git: GitOps) => Effect.Effect<A, GitError>): Promise<A>;
  makeCommit(input: CommitInput): string;
  /** Points `refs/heads/<name>` at `sha`. */
  setBranch(name: string, sha: string): void;
  teardown(): void;
}

function sh(
  args: readonly string[],
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; input?: string } = {},
): string {
  return boundedOutput("git", [...args], {
    boundMs: GIT_BOUND_MS,
    cwd,
    ...(opts.env !== undefined ? { env: { ...process.env, ...opts.env } } : {}),
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
}

function makeRepo(prefix: string): { root: string; repo: string; restore: () => void } {
  const restoreGit = isolateGit();
  const root = mkdtempSync(join(tmpdir(), prefix));
  const repo = join(root, "repo");
  sh(["init", "-q", "-b", "main", repo], root);
  disableGitAutoMaintenance(repo);
  sh(["config", "--local", "user.name", "Fiona Fixer"], repo);
  sh(["config", "--local", "user.email", "fiona@fix.test"], repo);
  return {
    root,
    repo,
    restore: () => {
      removeTempDir(root);
      restoreGit();
    },
  };
}

function realCommit(root: string, repo: string, input: CommitInput): string {
  const env = { GIT_INDEX_FILE: join(root, `index-${Math.random().toString(16).slice(2)}`) };
  sh(["read-tree", "--empty"], repo, { env });
  const lines = Object.entries(input.files).map(([path, content]) => {
    const oid = sh(["hash-object", "-w", "--stdin"], repo, { input: content }).trim();
    return `100644 ${oid}\t${path}`;
  });
  if (lines.length > 0) {
    sh(["update-index", "--index-info"], repo, { env, input: `${lines.join("\n")}\n` });
  }
  const tree = sh(["write-tree"], repo, { env }).trim();
  return sh(["commit-tree", tree, ...input.parents.flatMap((p) => ["-p", p]), "-F", "-"], repo, {
    input: input.message,
    env: { GIT_COMMITTER_DATE: input.date, GIT_AUTHOR_DATE: input.date },
  }).trim();
}

function realWorld(): World {
  const { root, repo, restore } = makeRepo("phax-git-fix-search-");
  return {
    repo,
    run: (effect) => Effect.runPromise(Effect.provide(Effect.flatMap(Git, effect), NodeGitLayer)),
    makeCommit: (input) => realCommit(root, repo, input),
    setBranch: (name, sha) => {
      sh(["update-ref", `refs/heads/${name}`, sha], repo);
    },
    teardown: restore,
  };
}

// The fake world keeps each commit's tree, and seeds the fake with what git
// would answer: the commits a branch reaches, by committer date, and a patch id
// derived from the change against the first parent (none for an empty change).
function fakeWorld(): World {
  const fake = makeFakeGit();
  const commits = new Map<string, CommitInput>();
  let counter = 0;
  const changeOf = (
    input: CommitInput,
  ): readonly (readonly [string, string | null, string | null])[] => {
    const parentFiles = input.parents[0] === undefined ? {} : commits.get(input.parents[0])!.files;
    const paths = [
      ...new Set([...Object.keys(parentFiles), ...Object.keys(input.files)]),
    ].toSorted();
    return paths
      .map((p) => [p, parentFiles[p] ?? null, input.files[p] ?? null] as const)
      .filter(([, before, after]) => before !== after);
  };
  return {
    repo: "/fake/repo",
    run: (effect) => Effect.runPromise(effect(fake.impl)),
    makeCommit: (input) => {
      counter += 1;
      const sha = createHash("sha1").update(`commit-${counter}`).digest("hex");
      commits.set(sha, input);
      const change = changeOf(input);
      if (change.length > 0) {
        fake.impl.setPatchId(sha, createHash("sha1").update(JSON.stringify(change)).digest("hex"));
      }
      return sha;
    },
    setBranch: (name, sha) => {
      const reached = new Set<string>();
      const walk = [sha];
      while (walk.length > 0) {
        const next = walk.pop()!;
        if (reached.has(next)) continue;
        reached.add(next);
        walk.push(...commits.get(next)!.parents);
      }
      const ordered = [...reached]
        .map((s) => ({ sha: s, input: commits.get(s)! }))
        .toSorted((a, b) => Date.parse(a.input.date) - Date.parse(b.input.date));
      fake.impl.addRangeCommits(
        name,
        ...ordered.map((c) => ({
          sha: c.sha,
          committedAt: c.input.date,
          message: c.input.message,
        })),
      );
    },
    teardown: () => undefined,
  };
}

const DAY1 = "2026-01-01T10:00:00+00:00";
const DAY2 = "2026-01-02T10:00:00+00:00";
const DAY3 = "2026-01-03T10:00:00+00:00";
const DAY2_LATE = "2026-01-02T18:00:00+00:00";

describe.each([
  ["real git adapter", realWorld],
  ["fake git", fakeWorld],
] as const)("fix-search Git port contract: %s", (_name, makeWorld) => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    world.teardown();
  });

  describe("commitsSince", () => {
    it("lists the commits the tip reaches at or after the instant, oldest first", async () => {
      const first = world.makeCommit({
        parents: [],
        files: { "a.ts": "1\n" },
        message: "first\n",
        date: DAY1,
      });
      const second = world.makeCommit({
        parents: [first],
        files: { "a.ts": "2\n" },
        message: "second\n\nFinding: f-1\n",
        date: DAY2,
      });
      const third = world.makeCommit({
        parents: [second],
        files: { "a.ts": "3\n" },
        message: "third\n",
        date: DAY3,
      });
      const side = world.makeCommit({
        parents: [first],
        files: { "a.ts": "side\n" },
        message: "side\n",
        date: DAY2_LATE,
      });
      world.setBranch("main", third);
      world.setBranch("side", side);

      // An instant in another offset, equal to DAY2: the bound is inclusive.
      const listed = await world.run((g) =>
        g.commitsSince(world.repo, "main", "2026-01-02T11:00:00+01:00"),
      );
      // The instant, not its spelling: git 2.45 and later write UTC as `Z`, older ones as `+00:00`.
      expect(listed.map((c) => ({ ...c, committedAt: Date.parse(c.committedAt) }))).toEqual([
        { sha: second, committedAt: Date.parse(DAY2), message: "second\n\nFinding: f-1\n" },
        { sha: third, committedAt: Date.parse(DAY3), message: "third\n" },
      ]);
    });

    it("lists a newer commit behind an older-dated tip", async () => {
      const first = world.makeCommit({
        parents: [],
        files: { "a.ts": "1\n" },
        message: "first\n",
        date: DAY1,
      });
      const fix = world.makeCommit({
        parents: [first],
        files: { "a.ts": "2\n" },
        message: "fix\n",
        date: DAY3,
      });
      // Committed after the fix, dated before the instant (a skewed clock).
      const skewed = world.makeCommit({
        parents: [fix],
        files: { "a.ts": "3\n" },
        message: "skewed\n",
        date: DAY1,
      });
      world.setBranch("main", skewed);
      const listed = await world.run((g) => g.commitsSince(world.repo, "main", DAY2));
      expect(listed.map((c) => c.sha)).toEqual([fix]);
    });

    it("lists the whole reachable history when the instant is before it", async () => {
      const first = world.makeCommit({
        parents: [],
        files: { "a.ts": "1\n" },
        message: "first\n",
        date: DAY1,
      });
      const second = world.makeCommit({
        parents: [first],
        files: { "a.ts": "2\n" },
        message: "second\n",
        date: DAY2,
      });
      world.setBranch("main", second);
      const listed = await world.run((g) =>
        g.commitsSince(world.repo, "main", "2025-12-31T00:00:00Z"),
      );
      expect(listed.map((c) => c.sha)).toEqual([first, second]);
    });

    it("lists nothing when every commit is older than the instant", async () => {
      const first = world.makeCommit({
        parents: [],
        files: { "a.ts": "1\n" },
        message: "first\n",
        date: DAY1,
      });
      world.setBranch("main", first);
      expect(
        await world.run((g) => g.commitsSince(world.repo, "main", "2026-02-01T00:00:00Z")),
      ).toEqual([]);
    });

    it("fails with a GitError for a tip that does not resolve", async () => {
      const first = world.makeCommit({
        parents: [],
        files: { "a.ts": "1\n" },
        message: "first\n",
        date: DAY1,
      });
      world.setBranch("main", first);
      const result = await world.run((g) =>
        Effect.result(g.commitsSince(world.repo, "no-such-branch", DAY1)),
      );
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe("patchIds", () => {
    it("gives a change and its copy onto another base one id, another change another, an empty commit none", async () => {
      const base = world.makeCommit({
        parents: [],
        files: { "a.ts": "1\n" },
        message: "base\n",
        date: DAY1,
      });
      const fix = world.makeCommit({
        parents: [base],
        files: { "a.ts": "1\n", "fix.ts": "fixed\n" },
        message: "fix\n",
        date: DAY2,
      });
      const otherBase = world.makeCommit({
        parents: [],
        files: { "x.ts": "x\n" },
        message: "other base\n",
        date: DAY1,
      });
      const copied = world.makeCommit({
        parents: [otherBase],
        files: { "x.ts": "x\n", "fix.ts": "fixed\n" },
        message: "fix, rewritten\n",
        date: DAY3,
      });
      const different = world.makeCommit({
        parents: [base],
        files: { "a.ts": "2\n" },
        message: "different\n",
        date: DAY2,
      });
      const empty = world.makeCommit({
        parents: [fix],
        files: { "a.ts": "1\n", "fix.ts": "fixed\n" },
        message: "empty\n",
        date: DAY3,
      });

      const ids = await world.run((g) => g.patchIds(world.repo, [fix, copied, different, empty]));
      expect(ids.get(fix)).toMatch(/^[0-9a-f]{40}$/);
      expect(ids.get(copied)).toBe(ids.get(fix));
      expect(ids.get(different)).toMatch(/^[0-9a-f]{40}$/);
      expect(ids.get(different)).not.toBe(ids.get(fix));
      expect(ids.has(empty)).toBe(false);
      expect([...ids.keys()].toSorted()).toEqual([fix, copied, different].toSorted());
    });

    it("gives a root commit an id", async () => {
      const root = world.makeCommit({
        parents: [],
        files: { "a.ts": "1\n", "d/b.ts": "2\n" },
        message: "root\n",
        date: DAY1,
      });
      const ids = await world.run((g) => g.patchIds(world.repo, [root]));
      expect(ids.get(root)).toMatch(/^[0-9a-f]{40}$/);
    });

    it("answers an empty map for no commits", async () => {
      const ids = await world.run((g) => g.patchIds(world.repo, []));
      expect(ids.size).toBe(0);
    });
  });
});

describe("fix-search Git port: real adapter only", () => {
  let root: string;
  let repo: string;
  let restore: () => void;

  beforeEach(() => {
    ({ root, repo, restore } = makeRepo("phax-git-fix-search-real-"));
  });

  afterEach(() => {
    restore();
  });

  const run = <A>(effect: (git: GitOps) => Effect.Effect<A, GitError>): Promise<A> =>
    Effect.runPromise(Effect.provide(Effect.flatMap(Git, effect), NodeGitLayer));
  const commit = (input: CommitInput) => realCommit(root, repo, input);

  it("keeps a message byte for byte, one newline short of commitMessage's answer", async () => {
    const messages = [
      "Fix the parser\n\nFirst paragraph.\n\n\nSecond, after two blank lines.\n",
      "Fix with trailers first\n\nFinding-Run: run-1\nFinding: f-1\n\nA closing paragraph.\n",
      "Corrige l'élément « déjà vu » 修正 🚀\n\nCorps non ASCII : ça marche.\n",
      "Trailing blank lines kept\n\n\n",
      "No trailing newline",
    ];
    let parent: string | null = null;
    const shas: string[] = [];
    for (const [i, message] of messages.entries()) {
      const sha = commit({
        parents: parent === null ? [] : [parent],
        files: { "a.ts": `${i}\n` },
        message,
        date: DAY1,
      });
      shas.push(sha);
      parent = sha;
    }
    sh(["update-ref", "refs/heads/main", parent!], repo);

    const listed = await run((g) => g.commitsSince(repo, "main", DAY1));
    expect(listed.map((c) => c.sha).toSorted()).toEqual(shas.toSorted());
    for (const entry of listed) {
      expect(entry.message).toBe(messages[shas.indexOf(entry.sha)]);
      const viaCommitMessage = await run((g) => g.commitMessage(repo, entry.sha));
      expect(viaCommitMessage).toBe(`${entry.message}\n`);
    }
  });

  it("gives a merge commit the patch id of its diff against its first parent", async () => {
    const base = commit({ parents: [], files: { "a.ts": "1\n" }, message: "base\n", date: DAY1 });
    const left = commit({
      parents: [base],
      files: { "a.ts": "1\n", "left.ts": "l\n" },
      message: "left\n",
      date: DAY2,
    });
    const right = commit({
      parents: [base],
      files: { "a.ts": "1\n", "right.ts": "r\n" },
      message: "right\n",
      date: DAY2,
    });
    const merge = commit({
      parents: [left, right],
      files: { "a.ts": "1\n", "left.ts": "l\n", "right.ts": "r\n" },
      message: "merge\n",
      date: DAY3,
    });
    const diff = sh(["diff", "--no-color", "--no-ext-diff", left, merge], repo);
    const expected = sh(["patch-id", "--stable"], repo, { input: diff }).split(" ")[0];
    const ids = await run((g) => g.patchIds(repo, [merge]));
    expect(ids.get(merge)).toBe(expected);
  });

  it("gives a commit git cherry-picked onto another base its patch id", async () => {
    const base = commit({ parents: [], files: { "a.ts": "1\n" }, message: "base\n", date: DAY1 });
    const fix = commit({
      parents: [base],
      files: { "a.ts": "1\n", "fix.ts": "one\ntwo\n" },
      message: "fix\n",
      date: DAY2,
    });
    const other = commit({
      parents: [],
      files: { "x.ts": "x\n" },
      message: "other\n",
      date: DAY1,
    });
    sh(["update-ref", "refs/heads/other", other], repo);
    sh(["checkout", "-q", "other"], repo);
    sh(["cherry-pick", fix], repo, {
      env: { GIT_COMMITTER_DATE: DAY3, GIT_AUTHOR_DATE: DAY3 },
    });
    const picked = sh(["rev-parse", "HEAD"], repo).trim();
    expect(picked).not.toBe(fix);
    const ids = await run((g) => g.patchIds(repo, [fix, picked]));
    expect(ids.get(picked)).toBe(ids.get(fix));
    expect(ids.get(fix)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("answers every commit of a range longer than one batch", async () => {
    // 205 commits through one fast-import stream, each adding its own file.
    const count = 205;
    const blocks: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      const content = `content ${i}\n`;
      const message = `commit ${i}\n`;
      blocks.push(
        [
          "commit refs/heads/main",
          `mark :${i}`,
          `committer Fiona Fixer <fiona@fix.test> ${1767261600 + i} +0000`,
          `data ${Buffer.byteLength(message)}`,
          message,
          ...(i > 1 ? [`from :${i - 1}`] : []),
          `M 100644 inline f${i}.txt`,
          `data ${Buffer.byteLength(content)}`,
          content,
        ].join("\n"),
      );
    }
    sh(["fast-import", "--quiet"], repo, { input: `${blocks.join("\n")}\n` });
    const listed = await run((g) => g.commitsSince(repo, "main", "2026-01-01T00:00:00Z"));
    expect(listed).toHaveLength(count);
    expect(listed.map((c) => c.message)).toEqual(
      Array.from({ length: count }, (_, i) => `commit ${i + 1}\n`),
    );
    const ids = await run((g) =>
      g.patchIds(
        repo,
        listed.map((c) => c.sha),
      ),
    );
    expect(ids.size).toBe(count);
    expect(new Set(ids.values()).size).toBe(count);
  });

  it("moves no ref and writes no object", async () => {
    const base = commit({ parents: [], files: { "a.ts": "1\n" }, message: "base\n", date: DAY1 });
    const next = commit({
      parents: [base],
      files: { "a.ts": "2\n" },
      message: "next\n",
      date: DAY2,
    });
    sh(["update-ref", "refs/heads/main", next], repo);
    const refsBefore = sh(["for-each-ref"], repo);
    const objectsBefore = sh(["count-objects", "-v"], repo);

    await run((g) => g.commitsSince(repo, "main", DAY1));
    await run((g) => g.patchIds(repo, [base, next]));

    expect(sh(["for-each-ref"], repo)).toBe(refsBefore);
    expect(sh(["count-objects", "-v"], repo)).toBe(objectsBefore);
  });
});
