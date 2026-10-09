import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { generateReviewHandoff } from "../../src/app/reviewHandoff.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import type { BranchName } from "../../src/domain/branded.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { encodePhaseFileReconciliation } from "../../src/schemas/reconciliation.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const now = "2024-01-01T00:00:00.000Z";

function makePhaseStatus(phaseId: string, phaseIndex: number): PhaseStatus {
  return {
    phaseId,
    phaseIndex,
    state: "committed",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: `feature/test-run--${phaseId}` as BranchName,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
    worktreePath: `/fake/worktrees/test-run/${phaseId}`,
    claudeSessionId: "sess-abc",
  };
}

function makeRunReviewInfo(phaseIds: readonly string[]): RunReviewInfo {
  const phaseStatuses = phaseIds.map((id, idx) => makePhaseStatus(id, idx));
  return {
    namespace: "test-project",
    shortName,
    runId: "test-run-999",
    runState: "running",
    branch: "feature/test-run",
    runTitle: undefined,
    finalPhaseBranch: `feature/test-run--${phaseIds.at(-1)}` as BranchName,
    stateRoot,
    runPath,
    finalPhaseId: phaseIds.at(-1) ?? "phase-01",
    finalPhaseTitle: "Final Phase",
    worktreePath: `/fake/worktrees/test-run/${phaseIds.at(-1)}`,
    claudeSessionId: "sess-abc",
    gateProfileId: "full",
    phaseStatuses,
    planPhases: phaseIds.map((id, i) => ({ id, title: `Phase ${i + 1}` })),
    updatedAt: now,
    stoppedReason: undefined,
    lastError: undefined,
  };
}

function makeEmptyReconciliationJson(phaseId: string): string {
  return JSON.stringify(
    encodePhaseFileReconciliation({
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
    }),
  );
}

function makeReconciliationJsonWithDeviation(phaseId: string): string {
  return JSON.stringify(
    encodePhaseFileReconciliation({
      phaseId,
      createdAsPlanned: ["src/planned.ts"],
      editedAsPlanned: [],
      missingPlannedCreate: [],
      missingPlannedEdit: ["src/missing-edit.ts"],
      createdButPlannedEdit: [],
      editedButPlannedCreate: [],
      unplannedCreated: ["src/unplanned.ts"],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: true,
    }),
  );
}

function setupLayers() {
  const fs = makeFakeFileSystem();
  const layers = Layer.mergeAll(fs.layer, NoopSystemTelemetryLayer);
  return { impl: fs.impl, layers };
}

function setupPhaseFiles(
  impl: ReturnType<typeof makeFakeFileSystem>["impl"],
  phaseId: string,
  reconciliationJson: string,
  fileRecMd?: string,
  phaseHandoffMd?: string,
): void {
  impl.setFile(`${runPath}/${phaseId}/file-reconciliation.json`, reconciliationJson);
  impl.setFile(
    `${runPath}/${phaseId}/file-reconciliation.md`,
    fileRecMd ?? `## File Reconciliation for ${phaseId}\n\nNo deviations.`,
  );
  impl.setFile(
    `${runPath}/${phaseId}/phase-handoff.md`,
    phaseHandoffMd ?? `## Phase Handoff for ${phaseId}\n\nAll done.`,
  );
}

describe("generateReviewHandoff", () => {
  it("writes review-handoff.md to the run path", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    expect(impl.getFile(`${runPath}/review-handoff.md`)).toBeDefined();
  });

  it("review-handoff.md contains run summary with short name, run id, and branch", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain(shortName);
    expect(handoff).toContain("test-run-999");
    expect(handoff).toContain("feature/test-run");
  });

  it("review-handoff.md does NOT contain entry commands (those are in final-report.md)", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).not.toContain("phax enter");
    expect(handoff).not.toContain("claude --resume");
  });

  it("final-report.md contains entry commands and conductor handoff", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const report = impl.getFile(`${runPath}/final-report.md`)!;
    expect(report).toBeDefined();
    expect(report).toContain("phax enter test-run");
    expect(report).toContain("phax shell test-run");
    expect(report).toContain("claude --resume sess-abc");
    expect(report).toContain("Conductor Handoff");
  });

  it("review-handoff.md includes the global file reconciliation table", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("Global File Reconciliation");
  });

  it("review-handoff.md carries the run folder's source-spec outcome under ## Source spec", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));
    const outcome =
      "`docs/specs/2609101270-demo.md` — kept: this plan does not complete it (completes-spec: false)";
    impl.setFile(`${runPath}/source-spec-outcome.md`, `${outcome}\n`);

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain(`## Source spec\n\n${outcome}\n`);
  });

  it("review-handoff.md has no ## Source spec section without the outcome fragment", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).not.toContain("## Source spec");
  });

  it("review-handoff.md embeds per-phase file-reconciliation.md content verbatim", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    const phaseRecMd = "## File Reconciliation for phase-01\n\nSentinel content abc123.";
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"), phaseRecMd);

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("Sentinel content abc123.");
    // Byte-identical content is embedded
    expect(handoff).toContain(phaseRecMd);
  });

  it("review-handoff.md embeds per-phase phase-handoff.md content verbatim", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    const phaseHandoffContent = "## Phase Handoff\n\nUnique handoff marker xyz789.";
    setupPhaseFiles(
      impl,
      "phase-01",
      makeEmptyReconciliationJson("phase-01"),
      undefined,
      phaseHandoffContent,
    );

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("Unique handoff marker xyz789.");
    expect(handoff).toContain(phaseHandoffContent);
  });

  it("review-handoff.md includes Deviations not explained section", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("Deviations not explained in any handoff");
  });

  it("unexplained deviation is listed when handoff does not mention the path", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    // phase-01 has unplanned file; handoff does NOT mention it
    setupPhaseFiles(
      impl,
      "phase-01",
      makeReconciliationJsonWithDeviation("phase-01"),
      undefined,
      "## What the next phase needs to know\n\nAll good, no special deviations.",
    );

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("src/unplanned.ts");
    expect(handoff).toContain("src/missing-edit.ts");
  });

  it("explained deviation is not listed when handoff mentions the path", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    // phase-01 has unplanned file; handoff DOES mention both deviating paths
    setupPhaseFiles(
      impl,
      "phase-01",
      makeReconciliationJsonWithDeviation("phase-01"),
      undefined,
      "## What the next phase needs to know\n\nsrc/unplanned.ts was added for X. src/missing-edit.ts was skipped because Y.",
    );

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    // Section exists but lists None
    expect(handoff).toContain("Deviations not explained in any handoff");
    // The paths are mentioned in the per-phase section (verbatim handoff), but not in the unexplained list
    const unexplainedSection = handoff.split("## Deviations not explained in any handoff")[1]!;
    const beforeNextSection = unexplainedSection.split("##")[0]!;
    expect(beforeNextSection).toContain("_None._");
  });

  it("with two phases and a deviation, attention points reference the deviating phase", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01", "phase-02"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));
    setupPhaseFiles(impl, "phase-02", makeReconciliationJsonWithDeviation("phase-02"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("Global review attention points");
    expect(handoff).toContain("src/unplanned.ts");
    expect(handoff).toContain("src/missing-edit.ts");
  });

  it("fails with ReviewHandoffArtifactMissingError when phase-handoff.md is missing and allowPartial is false", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    impl.setFile(
      `${runPath}/phase-01/file-reconciliation.json`,
      makeEmptyReconciliationJson("phase-01"),
    );
    impl.setFile(
      `${runPath}/phase-01/file-reconciliation.md`,
      "## File Reconciliation for phase-01",
    );
    // phase-handoff.md is intentionally missing

    await expect(
      Effect.runPromise(
        generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
      ),
    ).rejects.toThrow();
  });

  it("with allowPartial, produces a partial review-handoff.md when per-phase files are missing", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    impl.setFile(
      `${runPath}/phase-01/file-reconciliation.json`,
      makeEmptyReconciliationJson("phase-01"),
    );
    // file-reconciliation.md and phase-handoff.md are intentionally missing

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: true }).pipe(Effect.provide(layers)),
    );

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toBeDefined();
    expect(handoff).toContain("PARTIAL");
  });

  it("writes global-file-reconciliation.md and global-file-reconciliation.json", async () => {
    const { impl, layers } = setupLayers();
    const info = makeRunReviewInfo(["phase-01"]);
    setupPhaseFiles(impl, "phase-01", makeEmptyReconciliationJson("phase-01"));

    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    expect(impl.getFile(`${runPath}/global-file-reconciliation.md`)).toBeDefined();
    expect(impl.getFile(`${runPath}/global-file-reconciliation.json`)).toBeDefined();
  });
});

const HW_NOTE = "src/greet.ts now prints a farewell; check the wording with the maintainers";
const DOCS_NOTE = "the README example still shows the old greeting";

function checkedReport(review: ReadonlyArray<{ owner: string; note: string }>): string {
  return `${JSON.stringify(
    { $schema: currentSchemaUrl("gate-report"), outcome: "checked", findings: [], review },
    null,
    2,
  )}\n`;
}

function setGateAttempt(
  impl: ReturnType<typeof makeFakeFileSystem>["impl"],
  phaseId: string,
  attempt: string,
  reports: Readonly<Record<string, string>>,
): void {
  impl.setFile(`${runPath}/${phaseId}/checks-attempt-${attempt}.log`, "$ node ./audit.mjs\n");
  for (const [step, content] of Object.entries(reports)) {
    impl.setFile(`${runPath}/${phaseId}/checks-attempt-${attempt}.report-${step}.json`, content);
  }
}

async function generateHandoff(
  impl: ReturnType<typeof makeFakeFileSystem>["impl"],
  layers: ReturnType<typeof setupLayers>["layers"],
  phaseIds: readonly string[],
): Promise<string> {
  for (const phaseId of phaseIds) {
    setupPhaseFiles(impl, phaseId, makeEmptyReconciliationJson(phaseId));
  }
  await Effect.runPromise(
    generateReviewHandoff(makeRunReviewInfo(phaseIds), { allowPartial: false }).pipe(
      Effect.provide(layers),
    ),
  );
  return impl.getFile(`${runPath}/review-handoff.md`)!;
}

describe("generateReviewHandoff — review notes", () => {
  it("Review notes reach the review, grouped by owner", async () => {
    const { impl, layers } = setupLayers();
    setGateAttempt(impl, "phase-01", "01", {
      "01": checkedReport([{ owner: "hw-maintainers", note: HW_NOTE }]),
    });
    setGateAttempt(impl, "phase-02", "01", {
      "01": checkedReport([{ owner: "docs-team", note: DOCS_NOTE }]),
    });
    setGateAttempt(impl, "phase-03", "01", {
      "01": checkedReport([{ owner: "hw-maintainers", note: HW_NOTE }]),
    });

    const handoff = await generateHandoff(impl, layers, ["phase-01", "phase-02", "phase-03"]);

    expect(handoff).toContain(
      [
        "## Review notes",
        "",
        "Notes the gate steps left for a person. None was sent to the agent.",
        "",
        "### hw-maintainers",
        "",
        `- ${HW_NOTE} (phase-01, phase-03)`,
        "",
        "### docs-team",
        "",
        `- ${DOCS_NOTE} (phase-02)`,
        "",
        "## Phase details",
      ].join("\n"),
    );
    expect(handoff.split(HW_NOTE)).toHaveLength(2);
  });

  it("Only the last gate attempt counts", async () => {
    const { impl, layers } = setupLayers();
    setGateAttempt(impl, "phase-01", "01", {
      "01": checkedReport([{ owner: "hw-maintainers", note: HW_NOTE }]),
    });
    setGateAttempt(impl, "phase-01", "02", { "01": checkedReport([]) });

    const handoff = await generateHandoff(impl, layers, ["phase-01"]);

    expect(handoff).not.toContain("## Review notes");
    expect(handoff).not.toContain(HW_NOTE);
  });

  it("reads every report of the last attempt in step order", async () => {
    const { impl, layers } = setupLayers();
    setGateAttempt(impl, "phase-01", "02", {
      "02": checkedReport([{ owner: "b-team", note: "from step 2" }]),
      "01": checkedReport([{ owner: "a-team", note: "from step 1" }]),
    });

    const handoff = await generateHandoff(impl, layers, ["phase-01"]);

    expect(handoff.indexOf("### a-team")).toBeGreaterThan(0);
    expect(handoff.indexOf("### b-team")).toBeGreaterThan(handoff.indexOf("### a-team"));
  });

  it("skips refused, unreadable and other-format reports without failing", async () => {
    const { impl, layers } = setupLayers();
    setGateAttempt(impl, "phase-01", "01", {
      "01": JSON.stringify({
        $schema: currentSchemaUrl("gate-report"),
        outcome: "refused",
        reason: "the audit tool is not installed",
        remedy: "install it",
      }),
      "02": "not json",
      "03": JSON.stringify({ $schema: currentSchemaUrl("brief-report"), rules: [], findings: [] }),
    });

    const handoff = await generateHandoff(impl, layers, ["phase-01"]);

    expect(handoff).not.toContain("## Review notes");
  });

  it("renders no section when no phase ran a gate", async () => {
    const { impl, layers } = setupLayers();

    const handoff = await generateHandoff(impl, layers, ["phase-01"]);

    expect(handoff).not.toContain("## Review notes");
  });
});
