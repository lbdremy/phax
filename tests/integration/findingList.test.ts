import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { decodeFindingListFile } from "../../src/schemas/findingList.js";
import {
  buildFindingRunRepo,
  CURRENT_CODE_REVIEW,
  CURRENT_COMPLIANCE_REVIEW,
  type FindingRunRepo,
  reviewOnce,
  writeCurrentReviews,
  writeOlderReviews,
} from "../fixtures/findings/findingRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding list <run>` through the command runner, over a temporary repository holding one
// run in review_open (tests/fixtures/findings/findingRunRepo.ts). Frozen before the command
// exists: each test is expected to fail until phase-06 implements it.
//   ac-lift-unrecorded, ac-list-json and ac-rereview-continues.

const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];

interface ListedFinding {
  readonly id: string;
  readonly source: string;
  readonly phaseId?: string;
  readonly message: string;
  readonly fate: string;
  readonly history: readonly unknown[];
  readonly [key: string]: unknown;
}

describe("phax finding list", () => {
  let repo: FindingRunRepo;
  let origCwd: string;

  beforeEach(() => {
    repo = buildFindingRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const listJson = async () => {
    const result = await runnerCall([findingGroup], ["finding", "list", repo.shortName, "--json"]);
    expect(result.code).toBe(0);
    return { result, document: JSON.parse(result.out) as { findings: ListedFinding[] } };
  };

  // AC-lift-unrecorded
  it("lists reviews persisted before finding ids by position as unrecorded, leaving the files untouched", async () => {
    const before = writeOlderReviews(repo);
    const codePath = join(repo.runFolder, "code-review.json");
    const compliancePath = join(repo.runFolder, "compliance-review.json");

    const { document } = await listJson();
    expect(document.findings.map((f) => [f.id, f.source, f.phaseId ?? null])).toEqual([
      ["F1", "code-review", null],
      ["F2", "code-review", null],
      ["F3", "code-review", null],
      ["C1", "compliance-review", "phase-01"],
      ["C2", "compliance-review", "phase-02"],
      ["C3", "compliance-review", "phase-02"],
    ]);
    for (const finding of document.findings) {
      expect(finding.fate).toBe("unrecorded");
      expect(finding.history).toEqual([]);
    }

    const text = await runnerCall([findingGroup], ["finding", "list", repo.shortName]);
    expect(text.code).toBe(0);
    for (const id of ["F1", "F2", "F3", "C1", "C2", "C3"]) {
      const rows = text.outLines.filter((line) => new RegExp(`\\b${id}\\b`).test(line));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("unrecorded");
    }

    expect(readFileSync(codePath, "utf8")).toBe(before.codeReview);
    expect(readFileSync(compliancePath, "utf8")).toBe(before.complianceReview);
  });

  // AC-list-json
  it("writes one finding-list document with $schema first and only message lines on stderr", async () => {
    writeCurrentReviews(repo);

    const { result, document } = await listJson();
    expect(Object.keys(JSON.parse(result.out) as object)[0]).toBe("$schema");
    expect((document as unknown as { $schema: string }).$schema).toBe(
      currentSchemaUrl("finding-list"),
    );
    expect(Result.isSuccess(decodeFindingListFile(JSON.parse(result.out) as unknown))).toBe(true);
    expect(document).toMatchObject({
      run: { shortName: repo.shortName, runId: repo.runId, state: "review_open" },
      records: "read",
    });

    const [f1, f2, c1] = document.findings;
    expect(document.findings.map((f) => f.id)).toEqual(["F1", "F2", "C1"]);
    for (const [listed, stored] of [
      [f1, CURRENT_CODE_REVIEW.findings[0]],
      [f2, CURRENT_CODE_REVIEW.findings[1]],
    ] as const) {
      expect(listed).toMatchObject({
        source: "code-review",
        file: stored?.file,
        line: stored?.line,
        lens: stored?.lens,
        escape: stored?.escape,
        criterion: stored?.criterion,
        suggestion: stored?.suggestion,
      });
    }
    const stored = CURRENT_COMPLIANCE_REVIEW.perPhase[0]?.findings[0];
    expect(c1).toMatchObject({
      source: "compliance-review",
      phaseId: "phase-01",
      dimension: stored?.dimension,
    });
    for (const finding of document.findings) {
      expect(finding.fate).toBe("open");
      expect(finding.history).toEqual([]);
    }

    for (const line of result.errLines) {
      const message = JSON.parse(line) as { kind: string };
      expect(MESSAGE_KINDS).toContain(message.kind);
    }
  });

  // AC-rereview-continues
  it("keeps every earlier finding after a re-review: F1 to F5, F1 to F3 read from the records branch", async () => {
    await reviewOnce(repo, ["first one", "first two", "first three"]);
    await reviewOnce(repo, ["second one", "second two"]);

    const { document } = await listJson();
    expect(document.findings.map((f) => [f.id, f.fate, f.message])).toEqual([
      ["F1", "open", "first one"],
      ["F2", "open", "first two"],
      ["F3", "open", "first three"],
      ["F4", "open", "second one"],
      ["F5", "open", "second two"],
    ]);
    // The run folder holds only the second review: F1 to F3 are not in it.
    const stored = JSON.parse(readFileSync(join(repo.runFolder, "code-review.json"), "utf8")) as {
      findings: Array<{ id: string }>;
    };
    expect(stored.findings.map((f) => f.id)).toEqual(["F4", "F5"]);
  });
});
