import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { decodeFindingFateRecordManifestFile } from "../../src/schemas/findingFateRecord.js";
import {
  buildFateRunRepo,
  type FateRunRepo,
  findingListJson,
  head,
  turnRecordsOff,
  writeInWorktree,
} from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce, writeOlderReviews } from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding dismiss` and `phax finding defer` through the command runner, over a temporary
// repository holding one run in review_open (tests/fixtures/findings/fateRunRepo.ts). Frozen
// before the commands exist: each test is expected to fail until phase-07 implements them.
//   ac-dismiss, ac-defer, ac-settle-refusals, ac-machine-never-settles, ac-records-off
//   (dismiss and defer), ac-lift-settable, ac-latest-wins, ac-list-text.

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const RECORDS_BRANCH = "phax/records/v1";
const POINTER = "docs/briefs/gate-retry-docs.md";
const OPERATOR = { kind: "operator", name: "phax test" };

function git(repo: FateRunRepo, args: readonly string[]): string {
  return boundedOutput("git", [...args], { cwd: repo.repoDir, boundMs: GIT_BOUND_MS });
}

describe("phax finding dismiss and defer", () => {
  let repo: FateRunRepo;
  let origCwd: string;

  beforeEach(() => {
    repo = buildFateRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const dismiss = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "dismiss", repo.shortName, ...argv]);
  const defer = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "defer", repo.shortName, ...argv]);
  const fix = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "fix", repo.shortName, ...argv]);
  const recordsHead = () => head(repo, RECORDS_BRANCH);
  const recordsCount = () => Number(git(repo, ["rev-list", "--count", RECORDS_BRANCH]).trim());
  const entryOf = async (id: string) => {
    const { document } = await findingListJson(repo);
    const finding = document.findings.find((f) => f.id === id);
    if (finding === undefined) throw new Error(`${id} is not listed`);
    return finding;
  };

  // AC-dismiss
  it("records a dismissal as one decided verdict that chooses dismiss", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);
    const before = recordsCount();

    const result = await dismiss([
      "F3",
      "--by",
      "operator",
      "--why",
      "the second check guards --resume",
    ]);
    expect(result.code).toBe(0);

    expect(recordsCount()).toBe(before + 1);
    // A records commit holds only its own record: the tip's tree is the dismissal's record.
    const tree = git(repo, ["ls-tree", "-r", "--name-only", RECORDS_BRANCH])
      .split("\n")
      .filter((line) => line !== "");
    expect(tree).toEqual([`${repo.runId}/finding/F3/01/record.json`]);
    const text = git(repo, ["show", `${RECORDS_BRANCH}:${tree[0]}`]);
    const decoded = decodeFindingFateRecordManifestFile(JSON.parse(text) as unknown);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (!Result.isSuccess(decoded)) return;
    expect(decoded.success).toMatchObject({
      fate: "dismissed",
      verdict: {
        kind: "decided",
        chosen: "dismiss",
        abandoned: ["fix", "defer"],
        why: "the second check guards --resume",
        advocate: "Cover it with a test.",
        principles: [],
        reversibility: "cheap",
        revised: [],
        by: OPERATOR,
        at: expect.stringMatching(ISO_UTC),
      },
    });
  });

  // AC-defer
  it("records a deferral naming its pointer, reason and operator", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);

    const result = await defer([
      "F3",
      "--by",
      "operator",
      "--to",
      POINTER,
      "--why",
      "docs pass after the gate rework",
    ]);
    expect(result.code).toBe(0);

    const finding = await entryOf("F3");
    expect(finding.fate).toBe("deferred");
    expect(finding.history).toHaveLength(1);
    expect(finding.history[0]).toEqual({
      fate: "deferred",
      to: POINTER,
      why: "docs pass after the gate rework",
      by: OPERATOR,
      at: expect.stringMatching(ISO_UTC),
    });
  });

  // AC-settle-refusals
  it("refuses a missing reason, an untracked pointer and an unknown id", async () => {
    await reviewOnce(repo, ["one", "two", "three", "four", "five"]);
    const before = recordsHead();

    const noWhy = await dismiss(["F5", "--by", "operator"]);
    expect(noWhy.code).not.toBe(0);
    expect(noWhy.err).toContain("--why");

    const untracked = await defer([
      "F5",
      "--by",
      "operator",
      "--to",
      "docs/briefs/nope.md",
      "--why",
      "x",
    ]);
    expect(untracked.code).toBe(1);
    expect(untracked.err).toContain("docs/briefs/nope.md");

    const unknown = await dismiss(["F9", "--by", "operator", "--why", "x"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("F9");

    expect(recordsHead()).toBe(before);
  });

  // AC-machine-never-settles
  it("refuses a machine that dismisses or defers, leaving the finding open", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);
    const before = recordsHead();

    const dismissed = await dismiss(["F3", "--by", "machine:review-bot", "--why", "x"]);
    expect(dismissed.code).toBe(1);
    expect(dismissed.err).toMatch(/only an operator dismisses/i);

    const deferred = await defer([
      "F3",
      "--by",
      "machine:review-bot",
      "--to",
      POINTER,
      "--why",
      "x",
    ]);
    expect(deferred.code).toBe(1);
    expect(deferred.err).toMatch(/only an operator defers/i);

    expect((await entryOf("F3")).fate).toBe("open");
    expect(recordsHead()).toBe(before);
  });

  // AC-records-off (dismiss and defer)
  it("refuses a dismissal and a deferral with records off, naming the key", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);
    turnRecordsOff(repo);
    const runBefore = head(repo, repo.runBranch);
    const recordsBefore = recordsHead();
    const recordsOffTags = (errLines: readonly string[]) =>
      errLines
        .map((line) => JSON.parse(line) as { kind: string; error?: string; exit?: number })
        .filter((line) => line.kind === "error")
        .map((line) => [line.error, line.exit]);

    const dismissed = await dismiss(["F1", "--by", "operator", "--why", "not needed"]);
    expect(dismissed.code).toBe(1);
    expect(dismissed.err).toContain("add a records key to phax.json");
    const dismissedJson = await dismiss(["F1", "--by", "operator", "--why", "no", "--json"]);
    expect(dismissedJson.code).toBe(1);
    expect(recordsOffTags(dismissedJson.errLines)).toEqual([["FindingRecordsOffError", 1]]);

    const deferred = await defer(["F1", "--by", "operator", "--to", POINTER, "--why", "later"]);
    expect(deferred.code).toBe(1);
    expect(deferred.err).toContain("add a records key to phax.json");
    const deferredJson = await defer([
      "F1",
      "--by",
      "operator",
      "--to",
      POINTER,
      "--why",
      "later",
      "--json",
    ]);
    expect(deferredJson.code).toBe(1);
    expect(recordsOffTags(deferredJson.errLines)).toEqual([["FindingRecordsOffError", 1]]);

    expect(head(repo, repo.runBranch)).toBe(runBefore);
    expect(recordsHead()).toBe(recordsBefore);
  });

  // AC-lift-settable
  it("dismisses an unrecorded finding of an older review and lists it dismissed", async () => {
    writeOlderReviews(repo);

    const result = await dismiss([
      "F2",
      "--by",
      "operator",
      "--why",
      "superseded by the gate rework",
    ]);
    expect(result.code).toBe(0);

    const { document } = await findingListJson(repo);
    expect(document.findings.map((f) => [f.id, f.fate])).toEqual([
      ["F1", "unrecorded"],
      ["F2", "dismissed"],
      ["F3", "unrecorded"],
      ["C1", "unrecorded"],
      ["C2", "unrecorded"],
      ["C3", "unrecorded"],
    ]);
    expect(JSON.stringify((await entryOf("F2")).history)).toContain(
      "superseded by the gate rework",
    );

    const text = await runnerCall([findingGroup], ["finding", "list", repo.shortName]);
    expect(text.code).toBe(0);
    const lines = text.out.split("\n");
    const row = lines.findIndex((line) => line.includes("F2"));
    expect(row).toBeGreaterThanOrEqual(0);
    expect(lines[row + 1]).toContain("superseded by the gate rework");
  });

  // AC-latest-wins
  it("lists a finding dismissed then fixed as fixed, with both records oldest first", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);
    const dismissed = await dismiss(["F3", "--by", "operator", "--why", "not worth it"]);
    expect(dismissed.code).toBe(0);

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const fixed = await fix(["F3", "--by", "operator", "--", "tests/gate.test.ts"]);
    expect(fixed.code).toBe(0);

    const finding = await entryOf("F3");
    expect(finding.fate).toBe("fixed");
    expect(finding.history.map((entry) => entry.fate)).toEqual(["dismissed", "fixed"]);
  });

  // AC-list-text
  it("prints every finding with its fate and the details of that fate", async () => {
    await reviewOnce(repo, ["one", "two", "three", "four"]);
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const fixed = await fix(["F1", "--by", "operator", "--", "tests/gate.test.ts"]);
    expect(fixed.code).toBe(0);
    const sha = head(repo, repo.runBranch) as string;
    const dismissed = await dismiss([
      "F2",
      "--by",
      "operator",
      "--why",
      "the second check guards --resume",
    ]);
    expect(dismissed.code).toBe(0);
    const deferred = await defer(["F3", "--by", "operator", "--to", POINTER, "--why", "later"]);
    expect(deferred.code).toBe(0);

    const result = await runnerCall([findingGroup], ["finding", "list", repo.shortName]);
    expect(result.code).toBe(0);
    const lines = result.out.split("\n");
    for (const [id, message] of [
      ["F1", "one"],
      ["F2", "two"],
      ["F3", "three"],
      ["F4", "four"],
    ] as const) {
      const row = lines.find((line) => line.includes(id) && line.includes(message));
      expect(row, `row of ${id}`).toBeDefined();
      expect(row).toContain("concern");
      expect(row).toContain("src/reviewed.ts:7");
    }
    expect(result.out).toContain(sha.slice(0, 7));
    expect(result.out).toContain("tests");
    expect(result.out).toContain("the second check guards --resume");
    expect(result.out).toContain(POINTER);
  });

  it("records one commit per id when a dismissal names two", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);
    const before = recordsCount();

    const result = await dismiss(["F1", "F2", "--by", "operator", "--why", "x"]);
    expect(result.code).toBe(0);

    expect(recordsCount()).toBe(before + 2);
    const { document } = await findingListJson(repo);
    expect(document.findings.map((f) => [f.id, f.fate])).toEqual([
      ["F1", "dismissed"],
      ["F2", "dismissed"],
      ["F3", "open"],
    ]);
  });
});
