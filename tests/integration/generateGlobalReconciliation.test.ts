import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { generateGlobalReconciliation } from "../../src/app/generateGlobalReconciliation.js";
import { ReviewHandoffArtifactMissingError } from "../../src/domain/errors.js";
import type { GlobalFileReconciliation } from "../../src/domain/reconciliation/global.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";

const RUN_PATH = "/runs/test-run";
const RUN_ID = "run-id-001";

function makePhaseJson(
  phaseId: string,
  overrides: Partial<{
    createdAsPlanned: string[];
    editedAsPlanned: string[];
    missingPlannedCreate: string[];
    missingPlannedEdit: string[];
    unplannedCreated: string[];
    unplannedEdited: string[];
    optionalTouched: string[];
    deletions: string[];
    renames: { from: string; to: string }[];
    hasDeviations: boolean;
  }> = {},
): string {
  return JSON.stringify({
    phaseId,
    createdAsPlanned: [],
    editedAsPlanned: [],
    missingPlannedCreate: [],
    missingPlannedEdit: [],
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

describe("generateGlobalReconciliation", () => {
  it("happy path: aggregates phases and writes both global artifacts", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      makePhaseJson("phase-01", {
        createdAsPlanned: ["src/foo.ts"],
        editedAsPlanned: ["src/bar.ts"],
      }),
    );
    // phase-02 edits bar.ts without planning it → extra-touch for bar.ts
    impl.setFile(
      `${RUN_PATH}/phase-02/file-reconciliation.json`,
      makePhaseJson("phase-02", {
        unplannedEdited: ["src/bar.ts"],
        unplannedCreated: ["src/extra.ts"],
        hasDeviations: true,
      }),
    );

    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);
    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phaseIds: ["phase-01", "phase-02"],
        allowPartial: false,
        runId: RUN_ID,
      }).pipe(Effect.provide(layers)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const global = result.right;
    expect(global.files).toHaveLength(3); // foo.ts, bar.ts, extra.ts

    // bar.ts: planned only in phase-01, but also touched in phase-02 → extra-touch
    const barEntry = global.files.find((f) => f.path === "src/bar.ts");
    expect(barEntry?.status).toBe("extra-touch");
    expect(barEntry?.plannedInPhases).toEqual(["phase-01"]);
    expect(barEntry?.touchedInPhases).toEqual(["phase-01", "phase-02"]);

    const fooEntry = global.files.find((f) => f.path === "src/foo.ts");
    expect(fooEntry?.status).toBe("matched");

    const extraEntry = global.files.find((f) => f.path === "src/extra.ts");
    expect(extraEntry?.status).toBe("unplanned");

    expect(global.unplanned).toHaveLength(1);
    expect(global.unplanned[0]?.path).toBe("src/extra.ts");

    const jsonRaw = impl.getFile(`${RUN_PATH}/global-file-reconciliation.json`);
    expect(jsonRaw).toBeDefined();
    const parsed = JSON.parse(jsonRaw!) as GlobalFileReconciliation;
    expect(parsed.files).toHaveLength(3);

    const mdRaw = impl.getFile(`${RUN_PATH}/global-file-reconciliation.md`);
    expect(mdRaw).toBeDefined();
    expect(mdRaw).toContain("Global File Reconciliation");
    expect(mdRaw).toContain("src/bar.ts");
    expect(mdRaw).not.toContain("PARTIAL");
  });

  it("fails with ReviewHandoffArtifactMissingError when a phase is missing and allowPartial is false", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      makePhaseJson("phase-01", { createdAsPlanned: ["src/foo.ts"] }),
    );
    // phase-02 is absent

    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);
    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phaseIds: ["phase-01", "phase-02"],
        allowPartial: false,
        runId: RUN_ID,
      }).pipe(Effect.provide(layers)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;

    expect(result.left).toBeInstanceOf(ReviewHandoffArtifactMissingError);
    const err = result.left as ReviewHandoffArtifactMissingError;
    expect(err.missingPhases).toContain("phase-02");
    expect(err.missingPaths).toContain(`${RUN_PATH}/phase-02/file-reconciliation.json`);

    // No artifacts should have been written
    expect(impl.getFile(`${RUN_PATH}/global-file-reconciliation.json`)).toBeUndefined();
    expect(impl.getFile(`${RUN_PATH}/global-file-reconciliation.md`)).toBeUndefined();
  });

  it("fails when file-reconciliation.json fails schema decode and allowPartial is false", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      JSON.stringify({ phaseId: "phase-01" /* missing all required fields */ }),
    );

    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);
    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phaseIds: ["phase-01"],
        allowPartial: false,
        runId: RUN_ID,
      }).pipe(Effect.provide(layers)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left).toBeInstanceOf(ReviewHandoffArtifactMissingError);
    const err = result.left as ReviewHandoffArtifactMissingError;
    expect(err.missingPhases).toContain("phase-01");
  });

  it("allowPartial: aggregates decoded phases and prepends PARTIAL banner for missing", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      makePhaseJson("phase-01", { createdAsPlanned: ["src/foo.ts"] }),
    );
    // phase-02 is absent

    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);
    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phaseIds: ["phase-01", "phase-02"],
        allowPartial: true,
        runId: RUN_ID,
      }).pipe(Effect.provide(layers)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    // Aggregation over phase-01 only
    const global = result.right;
    expect(global.files).toHaveLength(1);
    expect(global.files[0]?.path).toBe("src/foo.ts");

    const mdRaw = impl.getFile(`${RUN_PATH}/global-file-reconciliation.md`);
    expect(mdRaw).toBeDefined();
    expect(mdRaw).toContain("PARTIAL");
    expect(mdRaw).toContain("phase-02");

    const jsonRaw = impl.getFile(`${RUN_PATH}/global-file-reconciliation.json`);
    expect(jsonRaw).toBeDefined();
  });

  it("empty phase list produces empty global artifacts", async () => {
    const { layer } = makeFakeFileSystem();
    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);

    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phaseIds: [],
        allowPartial: false,
        runId: RUN_ID,
      }).pipe(Effect.provide(layers)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    const global = result.right;
    expect(global.files).toHaveLength(0);
    expect(global.unplanned).toHaveLength(0);
    expect(global.missing).toHaveLength(0);
    expect(global.attentionPoints).toHaveLength(0);
  });
});
