import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { loadReviewedPhases } from "../../src/app/loadReviewHandoffInputs.js";
import { generateReviewHandoff } from "../../src/app/reviewHandoff.js";
import type { BranchName } from "../../src/domain/branded.js";
import { buildCompliancePrompt } from "../../src/domain/review/compliancePrompt.js";
import { buildShortPrBody } from "../../src/domain/publish/prBody.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { encodePhaseFileReconciliation } from "../../src/schemas/reconciliation.js";
import { CODE_REVIEW_AGENT_COMMANDS } from "../../src/domain/security/agentCommands.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { phaseStatus } from "../helpers/phaseStatusFixture.js";
import { reconciliationResult } from "../helpers/reconciliationFixture.js";

// A made-up invoice-export run at review_open, whose phase-02 was held and
// corrected, phase-03 was declared interactive and corrected, and phase-04
// was held and reviewed without change, each closed by Ada Example. The run
// folder is in memory; the surfaces are the real loaders and renderers.

const stateRoot = "/fake-state";
const runPath = `${stateRoot}/runs/invoice-export`;
const now = "2026-10-24T09:00:00.000Z";
const ADA = { name: "Ada Example", email: "ada@example.test" } as const;
const REVIEW_COMMIT = "a".repeat(40);

const HELD_CORRECTED = `## What was corrected
- The header row reads Invoice number.
- The amount column is right-aligned.

## The pattern to follow from now on
- Use EXPORT_LABELS.

## Guards
- tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS
- no guard: alignment is cosmetic

## What the next phases need to know
- Nothing.
`;

const DECLARED_CORRECTED = `## What was corrected
- The credit-note column order matches the invoice order.

## The pattern to follow from now on
- Credit notes mirror invoices.

## Guards
- tests/export/creditNoteRow.test.ts › column order

## What the next phases need to know
- Nothing.
`;

const UNCHANGED = `## What was corrected
- Nothing: the phase was reviewed and no file changed.

## The pattern to follow from now on
- Keep following the pattern the phase set.

## Guards
- no guard: nothing was corrected.

## What the next phases need to know
- Nothing beyond the phases' own handoffs.
`;

function status(
  phaseId: string,
  index: number,
  stop: PhaseStatus["stop"],
  mode: PhaseStatus["mode"] = "headless",
): PhaseStatus {
  return phaseStatus({
    phaseId,
    phaseIndex: index,
    state: "passed",
    model: "claude-sonnet-5-5",
    effort: "medium",
    branchName: `phax/invoice-export--${phaseId}`,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
    mode,
    stop,
  });
}

const PHASE_IDS = ["phase-01", "phase-02", "phase-03", "phase-04"] as const;

function info(statuses: readonly PhaseStatus[]): RunReviewInfo {
  return {
    namespace: "example",
    shortName: "invoice-export",
    runId: "run-1",
    runState: "review_open",
    branch: "phax/invoice-export",
    runTitle: undefined,
    finalPhaseBranch: "phax/invoice-export--phase-04" as BranchName,
    stateRoot,
    runPath,
    finalPhaseId: "phase-04",
    finalPhaseTitle: "Refund CSV record",
    worktreePath: "/fake/worktrees/phase-04",
    claudeSessionId: undefined,
    gateProfileId: "standard",
    phaseStatuses: statuses,
    planPhases: PHASE_IDS.map((id, i) => ({ id, title: `Made-up phase ${i + 1}` })),
    updatedAt: now,
    stoppedReason: undefined,
    lastError: undefined,
  };
}

const STOPPED = [
  status("phase-01", 0, null),
  status("phase-02", 1, {
    cause: "held",
    status: "closed",
    outcome: "corrected",
    reviewCommit: REVIEW_COMMIT,
    oracleStep: "none",
    closedBy: ADA,
  }),
  status(
    "phase-03",
    2,
    {
      cause: "declared",
      status: "closed",
      outcome: "corrected",
      oracleStep: "none",
      closedBy: ADA,
    },
    "interactive",
  ),
  status("phase-04", 3, { cause: "held", status: "closed", outcome: "unchanged", closedBy: ADA }),
];

function seed(impl: ReturnType<typeof makeFakeFileSystem>["impl"]): void {
  for (const id of PHASE_IDS) {
    impl.setFile(
      `${runPath}/${id}/file-reconciliation.json`,
      JSON.stringify(encodePhaseFileReconciliation({ phaseId: id, ...reconciliationResult() })),
    );
    impl.setFile(`${runPath}/${id}/file-reconciliation.md`, `## Reconciliation of ${id}`);
    impl.setFile(`${runPath}/${id}/phase-handoff.md`, `## Handoff of ${id}`);
  }
  for (const id of ["phase-02", "phase-04"]) {
    impl.setFile(
      `${runPath}/${id}/correction-reconciliation.json`,
      JSON.stringify(encodePhaseFileReconciliation({ phaseId: id, ...reconciliationResult() })),
    );
  }
  impl.setFile(`${runPath}/phase-02/correction-handoff.md`, HELD_CORRECTED);
  impl.setFile(`${runPath}/phase-03/phase-handoff.md`, DECLARED_CORRECTED);
  impl.setFile(`${runPath}/phase-04/correction-handoff.md`, UNCHANGED);
}

describe("the review surfaces of a run with stops", () => {
  it("shows each stop in review-handoff.md and in the PR lines", async () => {
    const fs = makeFakeFileSystem();
    seed(fs.impl);
    const layers = Layer.mergeAll(fs.layer, NoopSystemTelemetryLayer);
    const runInfo = info(STOPPED);

    await Effect.runPromise(
      generateReviewHandoff(runInfo, { allowPartial: false }).pipe(Effect.provide(layers)),
    );
    const handoff = fs.impl.getFile(`${runPath}/review-handoff.md`)!;

    expect(handoff).toContain("## Reviewed phases\n");
    expect(handoff).toContain("| phase-02 | held | corrected | Ada Example | 2 | 1 (1 no guard) |");
    expect(handoff).toContain("| phase-03 | interactive | corrected | Ada Example | 1 | 1 |");
    expect(handoff).toContain("| phase-04 | held | unchanged | Ada Example | 0 | — |");
    expect(handoff).toContain("### phase-02 (held)");
    expect(handoff).toContain("- The amount column is right-aligned.");
    expect(handoff).toContain("- tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS");
    expect(handoff).toContain("### phase-03 (interactive)");
    expect(handoff).toContain("- The credit-note column order matches the invoice order.");
    expect(handoff).not.toContain("### phase-04 (");
    expect(handoff.indexOf("## Deviations not explained in any handoff")).toBeLessThan(
      handoff.indexOf("## Reviewed phases"),
    );
    expect(handoff.indexOf("## Reviewed phases")).toBeLessThan(handoff.indexOf("## Phase details"));

    const reviewed = await Effect.runPromise(
      loadReviewedPhases(runInfo).pipe(Effect.provide(fs.layer)),
    );
    expect(reviewed.map((r) => r.reviewed.phaseId)).toEqual(["phase-02", "phase-03", "phase-04"]);

    const body = buildShortPrBody({
      qualifiedName: "example.invoice-export",
      shortName: "invoice-export",
      footer: {
        version: "0.0.0-test",
        plan: { kind: "unrecorded" },
        spec: { kind: "none" },
        agents: [],
        qualifiedName: "example.invoice-export",
      },
      sourceSpecOutcome: undefined,
      gateProfileId: "standard",
      phases: PHASE_IDS.map((id) => ({
        phaseId: id,
        title: `Made-up ${id}`,
        status: "passed" as const,
        stop: reviewed.find((r) => r.reviewed.phaseId === id)?.reviewed ?? null,
      })),
      verifiedSurfaces: [],
      compliance: { kind: "not-reviewed" },
      codeReview: { kind: "not-reviewed" },
      global: { files: [], unplanned: [], missing: [], attentionPoints: [] } as never,
      phaseHandoffs: [],
      reviewNoteGroups: [],
      runFolder: { path: runPath, homeDir: "/home/ada" },
      records: "not-configured",
    }).body;
    const lineOf = (id: string): string =>
      body.split("\n").find((l) => l.startsWith(`- \`${id}\``)) ?? "";
    expect(lineOf("phase-01")).not.toContain("by Ada Example");
    expect(lineOf("phase-02")).toMatch(/ · held, corrected by Ada Example \(1 guard\)$/);
    expect(lineOf("phase-03")).toMatch(/ · interactive, corrected by Ada Example \(1 guard\)$/);
    expect(lineOf("phase-04")).toMatch(/ · held, reviewed without change by Ada Example$/);
  });

  it("gives the compliance reviewer each stopped phase with its cause and handoff", async () => {
    const fs = makeFakeFileSystem();
    seed(fs.impl);
    const reviewed = await Effect.runPromise(
      loadReviewedPhases(info(STOPPED)).pipe(Effect.provide(fs.layer)),
    );

    const prompt = buildCompliancePrompt({
      planMd: "# Invoice export",
      reconciliationMd: "## Reconciliation",
      phases: PHASE_IDS.map((id) => ({ id, title: `Made-up ${id}` })),
      phaseHandoffs: [],
      reviewedPhases: reviewed.map((r) => ({
        phaseId: r.reviewed.phaseId,
        cause: r.reviewed.cause,
        handoffMd: r.handoffMd,
      })),
      worktreePath: "/fake/worktrees/phase-04",
      baseRef: null,
      runBranch: "feature/invoice-export",
      gitCommands: CODE_REVIEW_AGENT_COMMANDS,
    });

    expect(prompt).toContain("### Phase phase-02 (held stop)");
    expect(prompt).toContain("### Phase phase-03 (declared stop)");
    expect(prompt).toContain("- The credit-note column order matches the invoice order.");
    expect(prompt).toContain("- The amount column is right-aligned.");
    expect(prompt).toContain(
      "A person corrected this phase at a declared stop: judge its review corrections against its interactive handoff under Reviewed phases, not as plan deviations.",
    );
  });

  it("reads a stop whose handoff file is missing as a placeholder with no corrections", async () => {
    const fs = makeFakeFileSystem();
    const reviewed = await Effect.runPromise(
      loadReviewedPhases(info(STOPPED)).pipe(Effect.provide(fs.layer)),
    );
    expect(reviewed).toHaveLength(3);
    expect(reviewed[0]!.handoffMd).toBe("> PARTIAL — correction-handoff.md missing for phase-02");
    expect(reviewed[0]!.reviewed.summary.corrections).toEqual([]);
  });
});
