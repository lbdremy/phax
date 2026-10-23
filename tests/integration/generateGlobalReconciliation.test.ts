import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { generateGlobalReconciliation } from "../../src/app/generateGlobalReconciliation.js";
import { ReviewHandoffArtifactMissingError } from "../../src/domain/errors.js";
import type { GlobalFileReconciliation } from "../../src/domain/reconciliation/global.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { phaseReconciliationFile } from "../helpers/reconciliationFixture.js";

const RUN_PATH = "/runs/test-run";
const RUN_ID = "run-id-001";
const QUALIFIED_RUN_NAME = "test-project.test-run";

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

type PhaseStop = PhaseStatus["stop"];

/** The statuses the global reconciliation reads: their ids in plan order, none of them stopped. */
const phasesOf = (...ids: string[]) =>
  ids.map((phaseId, phaseIndex) => ({ phaseId, phaseIndex, stop: null as PhaseStop }));

const HELD_CORRECTED: PhaseStop = {
  cause: "held",
  status: "closed",
  outcome: "corrected",
  reviewCommit: "a".repeat(40),
  oracleStep: "none",
};

function runWith<A, E>(effect: Effect.Effect<A, E, never>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

describe("generateGlobalReconciliation", () => {
  it("aggregates a reconciliation phax writes ($schema) with one recorded before $schema", async () => {
    const { impl, layer } = makeFakeFileSystem();

    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      JSON.stringify(phaseReconciliationFile("phase-01", { createdAsPlanned: ["src/foo.ts"] })),
    );
    // Pre-schema: no $schema and no version, as 0.16.0 wrote it.
    impl.setFile(
      `${RUN_PATH}/phase-02/file-reconciliation.json`,
      makePhaseJson("phase-02", { unplannedCreated: ["src/extra.ts"], hasDeviations: true }),
    );

    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);
    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phases: phasesOf("phase-01", "phase-02"),
        allowPartial: false,
        runId: RUN_ID,
        qualifiedRunName: QUALIFIED_RUN_NAME,
      }).pipe(Effect.provide(layers)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.files.find((f) => f.path === "src/foo.ts")?.status).toBe("matched");
    expect(result.right.unplanned.map((f) => f.path)).toEqual(["src/extra.ts"]);
  });

  it("reads a 0.17.0 reconciliation and a stop's review corrections", async () => {
    const { impl, layer } = makeFakeFileSystem();

    // Stamped 0.17.0: written before `reviewCorrections` existed.
    impl.setFile(
      `${RUN_PATH}/phase-01/file-reconciliation.json`,
      JSON.stringify({
        $schema: schemaUrl("phase-file-reconciliation", "0.17.0"),
        ...JSON.parse(makePhaseJson("phase-01", { createdAsPlanned: ["src/credit.ts"] })),
      }),
    );
    impl.setFile(
      `${RUN_PATH}/phase-02/file-reconciliation.json`,
      JSON.stringify(
        phaseReconciliationFile("phase-02", {
          reviewCorrections: ["src/credit.ts", "src/invoice.ts"],
        }),
      ),
    );

    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);
    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phases: phasesOf("phase-01", "phase-02"),
        allowPartial: false,
        runId: RUN_ID,
        qualifiedRunName: QUALIFIED_RUN_NAME,
      }).pipe(Effect.provide(layers)),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    const credit = result.right.files.find((f) => f.path === "src/credit.ts");
    expect(credit?.status).toBe("matched");
    expect(credit?.reviewCorrectedInPhases).toEqual(["phase-02"]);
    const invoice = result.right.files.find((f) => f.path === "src/invoice.ts");
    expect(invoice?.status).toBe("review-corrected");
    expect(invoice?.attention).toBe("ok");
    expect(result.right.unplanned).toEqual([]);
  });

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
        phases: phasesOf("phase-01", "phase-02"),
        allowPartial: false,
        runId: RUN_ID,
        qualifiedRunName: QUALIFIED_RUN_NAME,
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
        phases: phasesOf("phase-01", "phase-02"),
        allowPartial: false,
        runId: RUN_ID,
        qualifiedRunName: QUALIFIED_RUN_NAME,
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
        phases: phasesOf("phase-01"),
        allowPartial: false,
        runId: RUN_ID,
        qualifiedRunName: QUALIFIED_RUN_NAME,
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
        phases: phasesOf("phase-01", "phase-02"),
        allowPartial: true,
        runId: RUN_ID,
        qualifiedRunName: QUALIFIED_RUN_NAME,
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

  describe("a held phase closed with a correction", () => {
    const heldPhases = [
      { phaseId: "phase-01", phaseIndex: 0, stop: null as PhaseStop },
      { phaseId: "phase-02", phaseIndex: 1, stop: HELD_CORRECTED },
    ];

    it("reads a file only the review changed as review-corrected and never unplanned", async () => {
      const { impl, layer } = makeFakeFileSystem();
      impl.setFile(
        `${RUN_PATH}/phase-01/file-reconciliation.json`,
        JSON.stringify(phaseReconciliationFile("phase-01", { createdAsPlanned: ["src/csv.ts"] })),
      );
      impl.setFile(
        `${RUN_PATH}/phase-02/file-reconciliation.json`,
        JSON.stringify(phaseReconciliationFile("phase-02", { createdAsPlanned: ["src/row.ts"] })),
      );
      // Only the review touched src/header.ts and src/row.ts.
      impl.setFile(
        `${RUN_PATH}/phase-02/correction-reconciliation.json`,
        JSON.stringify(
          phaseReconciliationFile("phase-02", {
            reviewCorrections: ["src/header.ts", "src/row.ts"],
          }),
        ),
      );

      const result = await runWith(
        generateGlobalReconciliation({
          runPath: RUN_PATH,
          phases: heldPhases,
          allowPartial: false,
          runId: RUN_ID,
          qualifiedRunName: QUALIFIED_RUN_NAME,
        }).pipe(Effect.provide(Layer.mergeAll(layer, NoopSystemTelemetryLayer))),
      );

      expect(Either.isRight(result)).toBe(true);
      if (!Either.isRight(result)) return;
      const header = result.right.files.find((f) => f.path === "src/header.ts");
      expect(header?.status).toBe("review-corrected");
      expect(header?.reviewCorrectedInPhases).toEqual(["phase-02"]);
      const row = result.right.files.find((f) => f.path === "src/row.ts");
      expect(row?.status).toBe("matched");
      expect(row?.reviewCorrectedInPhases).toEqual(["phase-02"]);
      expect(result.right.unplanned).toEqual([]);
    });

    it("counts a missing correction reconciliation as a missing reconciliation", async () => {
      const { impl, layer } = makeFakeFileSystem();
      impl.setFile(
        `${RUN_PATH}/phase-01/file-reconciliation.json`,
        JSON.stringify(phaseReconciliationFile("phase-01")),
      );
      impl.setFile(
        `${RUN_PATH}/phase-02/file-reconciliation.json`,
        JSON.stringify(phaseReconciliationFile("phase-02")),
      );
      const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);
      const run = (allowPartial: boolean) =>
        runWith(
          generateGlobalReconciliation({
            runPath: RUN_PATH,
            phases: heldPhases,
            allowPartial,
            runId: RUN_ID,
            qualifiedRunName: QUALIFIED_RUN_NAME,
          }).pipe(Effect.provide(layers)),
        );

      const refused = await run(false);
      expect(Either.isLeft(refused)).toBe(true);
      if (!Either.isLeft(refused)) return;
      expect(refused.left).toBeInstanceOf(ReviewHandoffArtifactMissingError);
      const error = refused.left as ReviewHandoffArtifactMissingError;
      expect(error.missingPhases).toEqual(["phase-02"]);
      expect(error.missingPaths).toEqual([`${RUN_PATH}/phase-02/correction-reconciliation.json`]);

      const partial = await run(true);
      expect(Either.isRight(partial)).toBe(true);
      expect(impl.getFile(`${RUN_PATH}/global-file-reconciliation.md`)).toContain("PARTIAL");
    });

    it("counts an undecodable correction reconciliation as missing too", async () => {
      const { impl, layer } = makeFakeFileSystem();
      impl.setFile(
        `${RUN_PATH}/phase-02/file-reconciliation.json`,
        JSON.stringify(phaseReconciliationFile("phase-02")),
      );
      impl.setFile(`${RUN_PATH}/phase-02/correction-reconciliation.json`, "{ not json");

      const result = await runWith(
        generateGlobalReconciliation({
          runPath: RUN_PATH,
          phases: [heldPhases[1]!],
          allowPartial: false,
          runId: RUN_ID,
          qualifiedRunName: QUALIFIED_RUN_NAME,
        }).pipe(Effect.provide(Layer.mergeAll(layer, NoopSystemTelemetryLayer))),
      );

      expect(Either.isLeft(result)).toBe(true);
    });

    it("reads no correction reconciliation for an unchanged held close or a declared one", async () => {
      const { impl, layer } = makeFakeFileSystem();
      impl.setFile(
        `${RUN_PATH}/phase-01/file-reconciliation.json`,
        JSON.stringify(phaseReconciliationFile("phase-01")),
      );
      impl.setFile(
        `${RUN_PATH}/phase-02/file-reconciliation.json`,
        JSON.stringify(phaseReconciliationFile("phase-02")),
      );

      const result = await runWith(
        generateGlobalReconciliation({
          runPath: RUN_PATH,
          phases: [
            {
              phaseId: "phase-01",
              phaseIndex: 0,
              stop: { cause: "held", status: "closed", outcome: "unchanged" },
            },
            {
              phaseId: "phase-02",
              phaseIndex: 1,
              stop: {
                cause: "declared",
                status: "closed",
                outcome: "corrected",
                oracleStep: "none",
              },
            },
          ],
          allowPartial: false,
          runId: RUN_ID,
          qualifiedRunName: QUALIFIED_RUN_NAME,
        }).pipe(Effect.provide(Layer.mergeAll(layer, NoopSystemTelemetryLayer))),
      );

      expect(Either.isRight(result)).toBe(true);
    });
  });

  it("empty phase list produces empty global artifacts", async () => {
    const { layer } = makeFakeFileSystem();
    const layers = Layer.mergeAll(layer, NoopSystemTelemetryLayer);

    const result = await runWith(
      generateGlobalReconciliation({
        runPath: RUN_PATH,
        phases: [],
        allowPartial: false,
        runId: RUN_ID,
        qualifiedRunName: QUALIFIED_RUN_NAME,
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
