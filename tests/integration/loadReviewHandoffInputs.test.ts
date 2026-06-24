import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { ReviewHandoffArtifactMissingError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  loadPhaseContents,
  loadReviewHandoffInputs,
} from "../../src/app/loadReviewHandoffInputs.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";

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
        version: 1,
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "passed",
        model: "claude-sonnet-4-6",
        effort: "medium",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        branchName: "phax/test-run--phase-01" as BranchName,
      },
      {
        version: 1,
        phaseId: "phase-02",
        phaseIndex: 1,
        state: "passed",
        model: "claude-sonnet-4-6",
        effort: "high",
        createdAt: "2026-01-01T00:01:00Z",
        updatedAt: "2026-01-01T00:01:00Z",
        branchName: "phax/test-run--phase-02" as BranchName,
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

function runWith<A, E>(effect: Effect.Effect<A, E, never>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

describe("loadReviewHandoffInputs", () => {
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
          version: 1,
          phaseId: "phase-02",
          phaseIndex: 1,
          state: "passed",
          model: "claude-sonnet-4-6",
          effort: "high",
          createdAt: "2026-01-01T00:01:00Z",
          updatedAt: "2026-01-01T00:01:00Z",
          branchName: "phax/test-run--phase-02" as BranchName,
        },
        {
          version: 1,
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "passed",
          model: "claude-sonnet-4-6",
          effort: "medium",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          branchName: "phax/test-run--phase-01" as BranchName,
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
