import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import {
  buildFateRunRepo,
  commitMessage,
  commitPaths,
  type FateRunRepo,
  findingListJson,
  head,
  lockRecordsBranch,
  setRunState,
  stageInWorktree,
  turnRecordsOff,
  worktreeStatus,
  writeInWorktree,
} from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce } from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding fix` through the command runner, over a temporary repository holding one run in
// review_open (tests/fixtures/findings/fateRunRepo.ts). Frozen before the command exists: each
// test is expected to fail until phase-05 implements it.
//   ac-fix-commits-named-paths, ac-fix-records, ac-list-json, ac-path-classes, ac-fix-refusals,
//   ac-fix-state, ac-machine-fix, ac-records-off (fix), ac-record-failure, ac-rereview-continues.

const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const RECORDS_BRANCH = "phax/records/v1";

describe("phax finding fix", () => {
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

  const fix = (argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "fix", repo.shortName, ...argv]);
  const runHead = () => head(repo, repo.runBranch);
  const recordsHead = () => head(repo, RECORDS_BRANCH);
  const entryOf = async (id: string) => {
    const { document } = await findingListJson(repo);
    const finding = document.findings.find((f) => f.id === id);
    if (finding === undefined) throw new Error(`${id} is not listed`);
    return finding;
  };

  // AC-fix-commits-named-paths
  it.fails("commits exactly the named paths with the trailers and leaves other changes alone", async () => {
    await reviewOnce(repo, ["one", "two", "three", "four", "five"]);
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 2;\n");
    writeInWorktree(repo, "README.md", "# findings\n\nChanged notes.\n");
    stageInWorktree(repo, "README.md");
    const before = runHead();

    const result = await fix(["F2", "F5", "--by", "operator", "--", "tests/gate.test.ts"]);
    expect(result.code).toBe(0);

    const after = runHead();
    expect(after).not.toBe(before);
    expect(head(repo, `${repo.runBranch}~1`)).toBe(before);
    expect(commitPaths(repo, after as string)).toEqual(["tests/gate.test.ts"]);
    const message = commitMessage(repo, after as string);
    expect(message.split("\n")[0]).toBe(`fix(review): F2, F5 of ${repo.shortName}`);
    const lines = message.split("\n");
    expect(lines.slice(-3)).toEqual([
      `Short-Name: ${repo.shortName}`,
      "Finding: F2",
      "Finding: F5",
    ]);
    expect(message).not.toContain("Run-Id");
    const status = worktreeStatus(repo);
    expect(status).toContain(" M src/app/gate.ts");
    expect(status).toContain("M  README.md");
    expect(status.some((line) => line.includes("tests/gate.test.ts"))).toBe(false);
  });

  // AC-fix-records and AC-list-json
  it.fails("records each finding fixed with its commit, classes and operator, and lists it", async () => {
    await reviewOnce(repo, ["one", "two", "three", "four", "five"]);
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");

    const result = await fix(["F2", "F5", "--by", "operator", "--", "tests/gate.test.ts"]);
    expect(result.code).toBe(0);
    const sha = runHead();

    const { result: listed, document } = await findingListJson(repo);
    expect(Object.keys(JSON.parse(listed.out) as object)[0]).toBe("$schema");
    expect((document as unknown as { $schema: string }).$schema).toBe(
      currentSchemaUrl("finding-list"),
    );
    expect(document.findings.map((f) => [f.id, f.fate])).toEqual([
      ["F1", "open"],
      ["F2", "fixed"],
      ["F3", "open"],
      ["F4", "open"],
      ["F5", "fixed"],
    ]);
    for (const id of ["F2", "F5"]) {
      const finding = document.findings.find((f) => f.id === id);
      expect(finding?.history).toHaveLength(1);
      expect(finding?.history[0]).toEqual({
        fate: "fixed",
        commit: sha,
        pathClasses: ["tests"],
        by: { kind: "operator", name: "phax test" },
        at: expect.stringMatching(ISO_UTC),
      });
    }
    for (const line of listed.errLines) {
      const message = JSON.parse(line) as { kind: string };
      expect(MESSAGE_KINDS).toContain(message.kind);
    }
  });

  // AC-path-classes
  it.fails("classes a commit of a test, a source and a docs file as code, docs, tests, also when backfilled", async () => {
    await reviewOnce(repo, ["one", "two", "three"]);
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 3;\n");
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 3;\n");
    writeInWorktree(repo, "docs/gates.md", "# Gates\n\nMore.\n");

    const first = await fix([
      "F1",
      "--by",
      "operator",
      "--",
      "tests/gate.test.ts",
      "src/app/gate.ts",
      "docs/gates.md",
    ]);
    expect(first.code).toBe(0);
    const sha = runHead() as string;
    expect((await entryOf("F1")).history[0]).toMatchObject({
      fate: "fixed",
      commit: sha,
      pathClasses: ["code", "docs", "tests"],
    });

    const second = await fix(["F3", "--commit", sha, "--by", "operator"]);
    expect(second.code).toBe(0);
    expect(runHead()).toBe(sha);
    expect((await entryOf("F3")).history[0]).toMatchObject({
      fate: "fixed",
      commit: sha,
      pathClasses: ["code", "docs", "tests"],
    });
  });

  // AC-fix-refusals
  it.fails("refuses no path, an unchanged path and an unknown id, committing and recording nothing", async () => {
    await reviewOnce(repo, ["one", "two"]);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 4;\n");
    const runBefore = runHead();
    const recordsBefore = recordsHead();

    const noPath = await fix(["F2", "--by", "operator"]);
    expect(noPath.code).toBe(1);
    expect(noPath.err).toMatch(/no path/i);

    const unchanged = await fix(["F2", "--by", "operator", "--", "docs/gates.md"]);
    expect(unchanged.code).toBe(1);
    expect(unchanged.err).toContain("docs/gates.md");

    const unknown = await fix(["F9", "--by", "operator", "--", "src/app/gate.ts"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("F9");

    expect(runHead()).toBe(runBefore);
    expect(recordsHead()).toBe(recordsBefore);
  });

  // AC-fix-state
  it.fails("refuses a run that is not review_open, naming its state", async () => {
    await reviewOnce(repo, ["one"]);
    setRunState(repo, "running");
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 5;\n");
    const runBefore = runHead();
    const recordsBefore = recordsHead();

    const result = await fix(["F1", "--by", "operator", "--", "src/app/gate.ts"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("running");
    expect(runHead()).toBe(runBefore);
    expect(recordsHead()).toBe(recordsBefore);
  });

  // AC-machine-fix
  it.fails("lets a machine fix with its grant, and refuses a call without --by and without a terminal", async () => {
    await reviewOnce(repo, ["one", "two"]);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 6;\n");

    const machine = await fix(["F1", "--by", "machine:review-bot", "--", "src/app/gate.ts"]);
    expect(machine.code).toBe(0);
    expect((await entryOf("F1")).history[0]).toMatchObject({
      fate: "fixed",
      by: { kind: "machine", grant: "review-bot" },
    });

    writeInWorktree(repo, "docs/gates.md", "# Gates\n\nChanged.\n");
    const before = runHead();
    const unattended = await fix(["F2", "--", "docs/gates.md"]);
    expect(unattended.code).not.toBe(0);
    expect(runHead()).toBe(before);
  });

  // AC-records-off (fix)
  it.fails("refuses with records off, naming the records key, before any commit", async () => {
    await reviewOnce(repo, ["one"]);
    turnRecordsOff(repo);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 7;\n");
    const before = runHead();

    const result = await fix(["F1", "--by", "operator", "--", "src/app/gate.ts"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("records");
    expect(runHead()).toBe(before);
  });

  // AC-record-failure
  it.fails("keeps the commit when its record fails and names the --commit retry", async () => {
    await reviewOnce(repo, ["one", "two"]);
    lockRecordsBranch(repo);
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 8;\n");
    const before = runHead();

    const result = await fix(["F2", "--by", "operator", "--", "tests/gate.test.ts"]);
    expect(result.code).toBe(1);
    const after = runHead() as string;
    expect(after).not.toBe(before);
    expect(head(repo, `${repo.runBranch}~1`)).toBe(before);
    expect(commitPaths(repo, after)).toEqual(["tests/gate.test.ts"]);
    expect(result.err).toContain("F2");
    expect(result.err).toContain(`phax finding fix ${repo.shortName} F2 --commit ${after}`);
  });

  // AC-rereview-continues
  it.fails("lists F1 to F5 after a re-review, with F2 fixed and the rest open", async () => {
    await reviewOnce(repo, ["first one", "first two", "first three"]);
    await reviewOnce(repo, ["second one", "second two"]);
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 9;\n");

    const result = await fix(["F2", "--by", "operator", "--", "tests/gate.test.ts"]);
    expect(result.code).toBe(0);

    const { document } = await findingListJson(repo);
    expect(document.findings.map((f) => [f.id, f.fate])).toEqual([
      ["F1", "open"],
      ["F2", "fixed"],
      ["F3", "open"],
      ["F4", "open"],
      ["F5", "open"],
    ]);
    expect(document.findings.slice(0, 3).map((f) => f.message)).toEqual([
      "first one",
      "first two",
      "first three",
    ]);
  });
});
