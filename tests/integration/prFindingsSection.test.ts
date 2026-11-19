import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { findingListJson, writeInWorktree } from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce } from "../fixtures/findings/findingRunRepo.js";
import {
  buildPrRunRepo,
  findingsSection,
  ghCalls,
  ghComments,
  installFakeGh,
  type PrRunRepo,
  publishPr,
  remoteHead,
  setPublishAuto,
  writeComplianceFinding,
} from "../fixtures/findings/prRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// The description of a run's pull request, as `phax publish-pr` writes it over the fake GitHub
// port (tests/fixtures/findings/prRunRepo.ts). Frozen before the findings section exists: each
// test is expected to fail until phase-04 implements it.
//   ac-pr-section, ac-pr-no-pr.

const POINTER = "docs/briefs/gate-retry-docs.md";
const FIVE = ["one", "two", "three", "four", "five"];

describe("the findings section of a pull request's description", () => {
  let repo: PrRunRepo;
  let origCwd: string;

  beforeEach(() => {
    repo = buildPrRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
    // No real gh is reachable from a test: this one answers and logs.
    installFakeGh(repo, "answers");
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const fate = (verb: string, argv: readonly string[]) =>
    runnerCall([findingGroup], ["finding", verb, repo.shortName, ...argv, "--by", "operator"]);
  const fix = (id: string, path: string) =>
    runnerCall(
      [findingGroup],
      ["finding", "fix", repo.shortName, id, "--by", "operator", "--", path],
    );

  /** The lines of the section, split on newlines. */
  const linesOf = (section: string | null): string[] => (section ?? "").split("\n");
  /** The `count` lines after the line `header`, and the line that follows them. */
  const blockAfter = (lines: readonly string[], header: string, count: number) => {
    const at = lines.indexOf(header);
    expect(at, `the section holds a line "${header}"`).not.toBe(-1);
    return { entries: lines.slice(at + 1, at + 1 + count), next: lines[at + 1 + count] };
  };

  // AC-pr-section
  it("names the open and deferred findings and counts the fixed and dismissed ones", async () => {
    setPublishAuto(repo, false);
    await reviewOnce(repo, FIVE);
    writeComplianceFinding(repo, "edited src/cli/ls.ts, not in the plan");

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    expect((await fix("F1", "tests/gate.test.ts")).code).toBe(0);
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 2;\n");
    expect((await fix("F2", "src/app/gate.ts")).code).toBe(0);
    expect((await fate("dismiss", ["F3", "--why", "the second check guards --resume"])).code).toBe(
      0,
    );
    expect(
      (await fate("defer", ["F5", "--to", POINTER, "--why", "docs pass after the gate rework"]))
        .code,
    ).toBe(0);

    const published = await publishPr(repo);
    expect(published.code).toBe(0);
    expect(published.body).not.toBeNull();
    const section = findingsSection(published.body as string);
    expect(section).not.toBeNull();
    const lines = linesOf(section);

    const open = blockAfter(lines, "Open (2)", 2);
    expect(open.entries[0]).toMatch(/^- F4 /);
    expect(open.entries[1]).toMatch(/^- C1 /);
    expect(open.next).toBe("");
    const deferred = blockAfter(lines, "Deferred (1)", 1);
    expect(deferred.entries[0]).toMatch(/^- F5 /);
    expect(deferred.entries[0]).toContain(POINTER);
    expect(lines).toContain("Fixed: 2 · Dismissed: 1");
    for (const id of ["F1", "F2", "F3"]) {
      expect(lines.some((line) => line.startsWith(`- ${id} `))).toBe(false);
    }
  });

  // AC-pr-no-pr
  it("carries the fates set while no pull request existed, which pushed and posted nothing", async () => {
    setPublishAuto(repo, true);
    await reviewOnce(repo, FIVE);
    const remoteBefore = remoteHead(repo);
    expect(remoteBefore).not.toBeNull();

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    expect((await fix("F2", "tests/gate.test.ts")).code).toBe(0);
    expect((await fate("dismiss", ["F3", "--why", "x"])).code).toBe(0);
    expect((await fate("defer", ["F5", "--to", POINTER, "--why", "y"])).code).toBe(0);

    expect(ghCalls(repo)).toEqual([]);
    expect(ghComments(repo)).toEqual([]);
    expect(remoteHead(repo)).toBe(remoteBefore);
    const { document } = await findingListJson(repo);
    const fateOf = (id: string) => document.findings.find((f) => f.id === id)?.fate;
    expect(fateOf("F2")).toBe("fixed");
    expect(fateOf("F3")).toBe("dismissed");
    expect(fateOf("F5")).toBe("deferred");

    const published = await publishPr(repo);
    expect(published.code).toBe(0);
    expect(published.body).not.toBeNull();
    const section = findingsSection(published.body as string);
    expect(section).not.toBeNull();
    const lines = linesOf(section);

    const open = blockAfter(lines, "Open (2)", 2);
    expect(open.entries[0]).toMatch(/^- F1 /);
    expect(open.entries[1]).toMatch(/^- F4 /);
    expect(open.next).toBe("");
    const deferred = blockAfter(lines, "Deferred (1)", 1);
    expect(deferred.entries[0]).toMatch(/^- F5 /);
    expect(deferred.entries[0]).toContain(POINTER);
    expect(lines).toContain("Fixed: 1 · Dismissed: 1");
  });
});
