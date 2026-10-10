import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { ReviewHandoffArtifactMissingError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  loadPhaseContents,
  loadReviewHandoffInputs,
  loadReviewNotes,
} from "../../src/app/loadReviewHandoffInputs.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import { currentSchemaUrl, withSchemaUrl } from "../../src/schemas/persisted.js";

const RUN_PATH = "/runs/test-run";

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName: "test-run",
    runId: "run-001",
    runState: "review_open",
    branch: "phax/test-run",
    runTitle: "Test Run",
    finalPhaseBranch: "phax/test-run--phase-02" as BranchName,
    stateRoot: "/runs",
    runPath: RUN_PATH,
    finalPhaseId: "phase-02",
    finalPhaseTitle: "Phase 02",
    worktreePath: "/wt/test-run/phase-02",
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [
      {
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "passed",
        model: "claude-sonnet-4-6",
        effort: "medium",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        branchName: "phax/test-run--phase-01" as BranchName,
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      },
      {
        phaseId: "phase-02",
        phaseIndex: 1,
        state: "passed",
        model: "claude-sonnet-4-6",
        effort: "high",
        createdAt: "2026-01-01T00:01:00Z",
        updatedAt: "2026-01-01T00:01:00Z",
        branchName: "phax/test-run--phase-02" as BranchName,
        base: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
      },
    ],
    planPhases: [
      { id: "phase-01", title: "Phase One" },
      { id: "phase-02", title: "Phase Two" },
    ],
    updatedAt: "2026-01-01T00:01:00Z",
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

function makePhaseJson(phaseId: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    phaseId,
    createdAsPlanned: [],
    editedAsPlanned: [],
    missingPlannedCreate: [],
    missingPlannedEdit: [],
    createdButPlannedEdit: [],
    editedButPlannedCreate: [],
    unplannedCreated: [],
    unplannedEdited: [],
    optionalTouched: [],
    deletions: [],
    renames: [],
    hasDeviations: false,
    ...overrides,
  });
}

// The same reconciliation as phax writes it today: `$schema` first.
function makeStampedPhaseJson(phaseId: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    withSchemaUrl("phase-file-reconciliation", JSON.parse(makePhaseJson(phaseId, overrides))),
  );
}

function runWith<A, E>(effect: Effect.Effect<A, E, never>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

describe("loadReviewHandoffInputs", () => {
  it("reads a reconciliation phax writes ($schema) beside one recorded before $schema", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      makeStampedPhaseJson("phase-01", { createdAsPlanned: ["src/foo.ts"] }),
    );
    // Pre-schema: no $schema and no version, as 0.16.0 wrote it.
    impl.setFile(
      `${RUN_PATH}/phase-02/file-reconciliation.json`,
      makePhaseJson("phase-02", { editedAsPlanned: ["src/bar.ts"] }),
    );

    const result = await runWith(loadReviewHandoffInputs(makeInfo()).pipe(Effect.provide(layer)));

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.global.files.map((f) => [f.path, f.status])).toEqual([
      ["src/bar.ts", "matched"],
      ["src/foo.ts", "matched"],
    ]);
  });

  it("happy path: aggregates per-phase JSON and reads markdown files", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      makePhaseJson("phase-01", { createdAsPlanned: ["src/foo.ts"] }),
    );
    impl.setFile(
      `${RUN_PATH}/phase-02/file-reconciliation.json`,
      makePhaseJson("phase-02", { editedAsPlanned: ["src/bar.ts"] }),
    );
    impl.setFile(`${RUN_PATH}/phase-01/file-reconciliation.md`, "## Phase 01 reconciliation");
    impl.setFile(`${RUN_PATH}/phase-01/phase-handoff.md`, "## Phase 01 handoff");
    impl.setFile(`${RUN_PATH}/phase-02/file-reconciliation.md`, "## Phase 02 reconciliation");
    impl.setFile(`${RUN_PATH}/phase-02/phase-handoff.md`, "## Phase 02 handoff");

    const result = await runWith(loadReviewHandoffInputs(makeInfo()).pipe(Effect.provide(layer)));

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const { global, globalMd, phaseContents } = result.right;

    expect(global.files).toHaveLength(2);
    expect(global.files.find((f) => f.path === "src/foo.ts")?.status).toBe("matched");
    expect(global.files.find((f) => f.path === "src/bar.ts")?.status).toBe("matched");

    expect(globalMd).toContain("Global File Reconciliation");
    expect(globalMd).toContain("test-project.test-run");

    expect(phaseContents).toHaveLength(2);
    expect(phaseContents[0]?.phaseId).toBe("phase-01");
    expect(phaseContents[0]?.title).toBe("Phase One");
    expect(phaseContents[0]?.fileReconciliationMd).toBe("## Phase 01 reconciliation");
    expect(phaseContents[0]?.phaseHandoffMd).toBe("## Phase 01 handoff");
    expect(phaseContents[1]?.phaseId).toBe("phase-02");
    expect(phaseContents[1]?.fileReconciliationMd).toBe("## Phase 02 reconciliation");
  });

  it("fails with ReviewHandoffArtifactMissingError when a phase JSON is missing", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(`${RUN_PATH}/phase-01/file-reconciliation.json`, makePhaseJson("phase-01"));
    // phase-02 JSON is absent

    const result = await runWith(loadReviewHandoffInputs(makeInfo()).pipe(Effect.provide(layer)));

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;

    expect(result.left).toBeInstanceOf(ReviewHandoffArtifactMissingError);
    const err = result.left as ReviewHandoffArtifactMissingError;
    expect(err.missingPhases).toContain("phase-02");
    expect(err.missingPaths).toContain(`${RUN_PATH}/phase-02/file-reconciliation.json`);
  });

  it("fails when JSON fails schema decode", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      JSON.stringify({ phaseId: "phase-01" /* missing required fields */ }),
    );
    impl.setFile(`${RUN_PATH}/phase-02/file-reconciliation.json`, makePhaseJson("phase-02"));

    const result = await runWith(loadReviewHandoffInputs(makeInfo()).pipe(Effect.provide(layer)));

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left).toBeInstanceOf(ReviewHandoffArtifactMissingError);
  });

  it("uses placeholder content for missing markdown files (does not fail)", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(`${RUN_PATH}/phase-01/file-reconciliation.json`, makePhaseJson("phase-01"));
    impl.setFile(`${RUN_PATH}/phase-02/file-reconciliation.json`, makePhaseJson("phase-02"));
    // No markdown files seeded

    const result = await runWith(loadReviewHandoffInputs(makeInfo()).pipe(Effect.provide(layer)));

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const { phaseContents } = result.right;
    expect(phaseContents[0]?.fileReconciliationMd).toContain("PARTIAL");
    expect(phaseContents[0]?.phaseHandoffMd).toContain("PARTIAL");
  });

  it("returns empty results for a run with no phases", async () => {
    const { layer } = makeFakeFileSystem();

    const infoNoPhases = makeInfo({ phaseStatuses: [], planPhases: [] });

    const result = await runWith(loadReviewHandoffInputs(infoNoPhases).pipe(Effect.provide(layer)));

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const { global, phaseContents } = result.right;
    expect(global.files).toHaveLength(0);
    expect(phaseContents).toHaveLength(0);
  });
});

/** A made-up checked gate report with no finding and the given review notes. */
function checkedReport(review: ReadonlyArray<{ owner: string; note: string }>): string {
  return JSON.stringify({
    $schema: currentSchemaUrl("gate-report"),
    outcome: "checked",
    findings: [],
    review,
  });
}

describe("loadReviewNotes", () => {
  const phaseFolder = `${RUN_PATH}/phase-01`;

  // Made-up attempts 01–03 of one phase: 02's report holds a review note, the
  // last attempt, 03, passed with none.
  function seedAttempts(lastReview: ReadonlyArray<{ owner: string; note: string }>) {
    const fs = makeFakeFileSystem();
    for (const attempt of ["01", "02", "03"]) {
      fs.impl.setFile(`${phaseFolder}/checks-attempt-${attempt}.log`, "$ node scripts/audit.mjs");
      fs.impl.setFile(
        `${phaseFolder}/checks-attempt-${attempt}.attribution.json`,
        JSON.stringify({
          $schema: currentSchemaUrl("gate-attribution"),
          phase: "phase-01",
          steps: [{ command: "node scripts/audit.mjs", surface: "structural", result: "pass" }],
        }),
      );
    }
    fs.impl.setFile(`${phaseFolder}/checks-attempt-01.report-01.json`, checkedReport([]));
    fs.impl.setFile(
      `${phaseFolder}/checks-attempt-02.report-01.json`,
      checkedReport([{ owner: "maintainers", note: "check the retry budget" }]),
    );
    fs.impl.setFile(`${phaseFolder}/checks-attempt-03.report-01.json`, checkedReport(lastReview));
    return fs;
  }

  const info = makeInfo({ phaseStatuses: makeInfo().phaseStatuses.slice(0, 1) });

  it("reads only the last recorded attempt, so an earlier attempt's note is left out", async () => {
    const fs = seedAttempts([]);
    const result = await runWith(loadReviewNotes(info).pipe(Effect.provide(fs.layer)));
    expect(result).toEqual(Either.right(undefined));
  });

  it("gives the last recorded attempt's notes", async () => {
    const fs = seedAttempts([{ owner: "maintainers", note: "whether the log reads well" }]);
    const result = await runWith(loadReviewNotes(info).pipe(Effect.provide(fs.layer)));
    if (Either.isLeft(result)) throw new Error("loadReviewNotes never fails");
    expect(result.right).toContain("whether the log reads well");
    expect(result.right).not.toContain("check the retry budget");
  });
});

describe("loadPhaseContents", () => {
  it("reads phase markdown files and returns correct PhaseContent entries", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(`${RUN_PATH}/phase-01/file-reconciliation.md`, "## Rec 01");
    impl.setFile(`${RUN_PATH}/phase-01/phase-handoff.md`, "## Handoff 01");
    impl.setFile(`${RUN_PATH}/phase-02/file-reconciliation.md`, "## Rec 02");
    impl.setFile(`${RUN_PATH}/phase-02/phase-handoff.md`, "## Handoff 02");

    const result = await runWith(loadPhaseContents(makeInfo()).pipe(Effect.provide(layer)));

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const { phaseContents, missingPhases, missingPaths } = result.right;
    expect(phaseContents).toHaveLength(2);
    expect(phaseContents[0]?.fileReconciliationMd).toBe("## Rec 01");
    expect(phaseContents[1]?.phaseHandoffMd).toBe("## Handoff 02");
    expect(missingPhases).toHaveLength(0);
    expect(missingPaths).toHaveLength(0);
  });

  it("records missing files in missingPhases and uses placeholder content", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(`${RUN_PATH}/phase-01/file-reconciliation.md`, "## Rec 01");
    // phase-01/phase-handoff.md missing
    impl.setFile(`${RUN_PATH}/phase-02/file-reconciliation.md`, "## Rec 02");
    impl.setFile(`${RUN_PATH}/phase-02/phase-handoff.md`, "## Handoff 02");

    const result = await runWith(loadPhaseContents(makeInfo()).pipe(Effect.provide(layer)));

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const { phaseContents, missingPhases, missingPaths } = result.right;
    expect(missingPhases).toContain("phase-01");
    expect(missingPaths).toContain(`${RUN_PATH}/phase-01/phase-handoff.md`);
    expect(phaseContents[0]?.phaseHandoffMd).toContain("PARTIAL");
    expect(phaseContents[0]?.fileReconciliationMd).toBe("## Rec 01");
  });

  it("respects phaseIndex ordering when building phaseContents", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(`${RUN_PATH}/phase-01/file-reconciliation.md`, "rec-01");
    impl.setFile(`${RUN_PATH}/phase-01/phase-handoff.md`, "handoff-01");
    impl.setFile(`${RUN_PATH}/phase-02/file-reconciliation.md`, "rec-02");
    impl.setFile(`${RUN_PATH}/phase-02/phase-handoff.md`, "handoff-02");

    // phaseStatuses in reverse index order to test sorting
    const infoReversed = makeInfo({
      phaseStatuses: [
        {
          phaseId: "phase-02",
          phaseIndex: 1,
          state: "passed",
          model: "claude-sonnet-4-6",
          effort: "high",
          createdAt: "2026-01-01T00:01:00Z",
          updatedAt: "2026-01-01T00:01:00Z",
          branchName: "phax/test-run--phase-02" as BranchName,
          base: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
        },
        {
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "passed",
          model: "claude-sonnet-4-6",
          effort: "medium",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          branchName: "phax/test-run--phase-01" as BranchName,
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        },
      ],
    });

    const result = await runWith(loadPhaseContents(infoReversed).pipe(Effect.provide(layer)));

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const { phaseContents } = result.right;
    expect(phaseContents[0]?.phaseId).toBe("phase-01");
    expect(phaseContents[1]?.phaseId).toBe("phase-02");
  });
});
