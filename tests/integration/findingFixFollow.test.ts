import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { findingListJson, head } from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce } from "../fixtures/findings/findingRunRepo.js";
import {
  buildRewriteRunRepo,
  dropUnreachable,
  fixByHandInWorktree,
  fixInWorktree,
  holds,
  rebaseAndMerge,
  type RewriteRunRepo,
} from "../fixtures/findings/rewriteRunRepo.js";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding fix --commit` follows a rewritten commit on the base branch (spec
// finding-fix-identity §5.15, §5.16), over a temporary repository holding one run in review_open
// (tests/fixtures/findings/rewriteRunRepo.ts) whose history git rewrites the way a merge does.
// Every refusal leaves phax/records/v1 where it was.

const RECORDS = "phax/records/v1";

function git(args: readonly string[], cwd: string): string {
  return boundedOutput("git", [...args], { cwd, boundMs: GIT_BOUND_MS }).trim();
}

const short = (sha: string) => sha.slice(0, 7);

describe("phax finding fix --commit: following a rewritten commit", () => {
  let repo: RewriteRunRepo;
  let origCwd: string;

  beforeEach(() => {
    repo = buildRewriteRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const fix = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "fix", repo.shortName, ...argv]);
  const commitsOf = async (id: string) => {
    const { document } = await findingListJson(repo);
    const finding = document.findings.find((f) => f.id === id);
    if (finding === undefined) throw new Error(`${id} is not listed`);
    return finding.history.flatMap((entry) => (entry.fate === "fixed" ? [entry.commit] : []));
  };

  // ac-commit-follow
  it("follows an old sha recreated on main by Rebase and merge, by key, naming both shas", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const old = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const main = rebaseAndMerge(repo);
    expect(holds(repo, old)).toBe(true);
    const records = head(repo, RECORDS);

    const result = await fix(["F1", "--commit", old, "--by", "operator"]);

    expect(result.code, result.err).toBe(0);
    expect(head(repo, RECORDS)).not.toBe(records);
    expect(await commitsOf("F1")).toEqual(expect.arrayContaining([old, main]));
    expect(result.outLines).toEqual([
      `✓ ${short(old)} is on neither ${repo.runBranch} nor main; its rewrite ${short(main)} on main carries ${repo.runId} F1 (by key)`,
      `✓ recorded F1 fixed by ${short(main)} (code) on ${RECORDS}`,
    ]);
  });

  it("answers the followed commit under --json", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const old = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const main = rebaseAndMerge(repo);

    const result = await fix(["F1", "--commit", old, "--by", "operator", "--json"]);

    expect(result.code, result.err).toBe(0);
    const answer: unknown = JSON.parse(result.out);
    expect(answer).toMatchObject({
      commit: {
        sha: main,
        followed: {
          named: old,
          notOn: [repo.runBranch, "main"],
          matches: [{ finding: "F1", by: "key" }],
          branch: "main",
        },
      },
    });
  });

  // ac-commit-follow-absent
  it("follows an old sha the repository no longer holds to the main commit carrying the key", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const old = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const main = rebaseAndMerge(repo);
    dropUnreachable(repo);
    expect(holds(repo, old)).toBe(false);

    const result = await fix(["F1", "--commit", old, "--by", "operator"]);

    expect(result.code, result.err).toBe(0);
    expect(await commitsOf("F1")).toContain(main);
    expect(result.outLines[0]).toBe(
      `✓ ${old} is not in the repository; its rewrite ${short(main)} on main carries ${repo.runId} F1 (by key)`,
    );
  });

  it("follows a trailer-less commit rebased onto main by its patch id", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const old = await fixByHandInWorktree(repo, ["F1"], "src/app/hand.ts", "export const h = 1;\n");
    const main = rebaseAndMerge(repo);
    expect(main).not.toBe(old);

    const result = await fix(["F1", "--commit", old, "--by", "operator"]);

    expect(result.code, result.err).toBe(0);
    expect(await commitsOf("F1")).toContain(main);
    expect(result.outLines[0]).toBe(
      `✓ ${short(old)} is on neither ${repo.runBranch} nor main; its rewrite ${short(main)} on main has its patch id (by patch id)`,
    );
  });

  // ac-commit-follow-refused
  describe("refuses before writing anything, naming each candidate", () => {
    it("when no main commit carries the key or the patch id", async () => {
      await reviewOnce(repo, ["one", "two"]);
      git(["switch", "-q", "-c", "side"], repo.repoDir);
      writeFileSync(join(repo.repoDir, "side.txt"), "side\n");
      git(["add", "side.txt"], repo.repoDir);
      git(["commit", "-q", "-m", "feat: side"], repo.repoDir);
      const side = git(["rev-parse", "HEAD"], repo.repoDir);
      git(["switch", "-q", "main"], repo.repoDir);
      const records = head(repo, RECORDS);

      const result = await fix(["F1", "--commit", side, "--by", "operator"]);

      expect(result.code).toBe(1);
      expect(result.err).toContain(`✗ fix refused: ${short(side)} is on neither `);
      expect(result.err).toContain(
        `, and no commit of main since the run started carries ${repo.runId} F1 or has its patch id: name a commit of the run branch or of the base branch with --commit`,
      );
      expect(head(repo, RECORDS)).toBe(records);
    });

    it("when two main commits carry the key", async () => {
      await reviewOnce(repo, ["one", "two"]);
      const first = await fixInWorktree(repo, ["F1"], "src/app/a.ts", "export const a = 1;\n");
      await fixInWorktree(repo, ["F1"], "src/app/a.ts", "export const a = 2;\n");
      const main = rebaseAndMerge(repo);
      const earlier = git(["rev-parse", `${main}~1`], repo.repoDir);
      const records = head(repo, RECORDS);

      const result = await fix(["F1", "--commit", first, "--by", "operator"]);

      expect(result.code).toBe(1);
      expect(result.err).toContain(
        `✗ fix refused: ${short(first)} is on neither ${repo.runBranch} nor main, and 2 commits of main carry ${repo.runId} F1: ${short(earlier)}, ${short(main)}. Name one with --commit`,
      );
      expect(head(repo, RECORDS)).toBe(records);
    });

    it("when F1 and F2 resolve to different commits", async () => {
      await reviewOnce(repo, ["one", "two"]);
      const a = await fixInWorktree(repo, ["F1"], "src/app/a.ts", "export const a = 1;\n");
      await fixInWorktree(repo, ["F2"], "src/app/b.ts", "export const b = 1;\n");
      const main = rebaseAndMerge(repo);
      const earlier = git(["rev-parse", `${main}~1`], repo.repoDir);
      const records = head(repo, RECORDS);

      const result = await fix(["F1", "F2", "--commit", a, "--by", "operator"]);

      expect(result.code).toBe(1);
      expect(result.err).toContain(
        `✗ fix refused: ${short(a)} is on neither ${repo.runBranch} nor main, and the named findings resolve to different commits of main: F1 → ${short(earlier)}, F2 → ${short(main)}. Name one with --commit`,
      );
      expect(head(repo, RECORDS)).toBe(records);
    });
  });

  describe("today's paths are unchanged", () => {
    it("refuses a value that is not a sha as before", async () => {
      await reviewOnce(repo, ["one"]);
      const records = head(repo, RECORDS);

      const result = await fix(["F1", "--commit", "not-a-sha", "--by", "operator"]);

      expect(result.code).toBe(1);
      expect(result.err).toContain(
        "✗ fix refused: --commit not-a-sha names no commit in the run's repository",
      );
      expect(head(repo, RECORDS)).toBe(records);
    });

    it("records a commit of the run branch as named, with no followed line", async () => {
      await reviewOnce(repo, ["one", "two"]);
      const hand = await fixByHandInWorktree(repo, ["F1"], "src/app/h.ts", "export const h = 1;\n");

      const result = await fix(["F2", "--commit", hand, "--by", "operator", "--json"]);

      expect(result.code, result.err).toBe(0);
      const answer: unknown = JSON.parse(result.out);
      expect(answer).toMatchObject({ commit: { sha: hand, followed: null } });
      expect(await commitsOf("F2")).toEqual([hand]);
    });

    it("records a commit of the base branch as named", async () => {
      await reviewOnce(repo, ["one"]);
      const onMain = git(["rev-parse", "main"], repo.repoDir);

      const result = await fix(["F1", "--commit", onMain, "--by", "operator"]);

      expect(result.code, result.err).toBe(0);
      expect(result.outLines).toEqual([
        `✓ recorded F1 fixed by ${short(onMain)} (docs) on ${RECORDS}`,
      ]);
      expect(await commitsOf("F1")).toEqual([onMain]);
    });
  });
});
