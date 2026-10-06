import { describe, expect, it } from "vitest";
import { buildReviewHandoffContent } from "../../src/app/reviewHandoff.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { GlobalFileReconciliation } from "../../src/domain/reconciliation/global.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";

const globalEmpty: GlobalFileReconciliation = {
  files: [],
  unplanned: [],
  missing: [],
  attentionPoints: [],
};

const globalMd =
  "## Global File Reconciliation\n\n**Run**: ns/run\n\n| File | Planned in | Touched in | Status | Notes |\n| --- | --- | --- | --- | --- |";

const info: RunReviewInfo = {
  namespace: "ns",
  shortName: "run",
  runId: "run-001",
  runState: "completed",
  branch: "phax/run",
  runTitle: "Test Run",
  finalPhaseBranch: "phax/run--phase-01" as BranchName,
  stateRoot: "/tmp/state",
  runPath: "/tmp/state/run",
  finalPhaseId: "phase-01",
  finalPhaseTitle: "Phase 01",
  worktreePath: "/tmp/worktrees/run/phase-01",
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
      branchName: "phax/run--phase-01" as BranchName,
    },
  ],
  planPhases: [{ id: "phase-01", title: "Phase 01" }],
  updatedAt: "2026-01-01T00:00:00Z",
  stoppedReason: undefined,
  lastError: undefined,
};

const phaseContents = [
  {
    phaseId: "phase-01",
    title: "Phase 01",
    fileReconciliationMd: "## PHAX File Reconciliation\n\nAll matched.",
    phaseHandoffMd: "## What was delivered\n\nDone.",
  },
];

describe("buildReviewHandoffContent — without compliance", () => {
  it("includes ## Phase details section", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents);
    expect(output).toContain("## Phase details");
  });

  it("includes ## Deviations not explained in any handoff section", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents);
    expect(output).toContain("## Deviations not explained in any handoff");
  });

  it("does not include ## Plan compliance review section", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents);
    expect(output).not.toContain("## Plan compliance review");
  });

  it("omitted compliance is byte-identical to four-argument call", () => {
    const withUndefined = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      complianceReviewMd: undefined,
    });
    const withoutArg = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents);
    expect(withUndefined).toBe(withoutArg);
  });
});

describe("buildReviewHandoffContent — with compliance", () => {
  const complianceMd = "## Verdict\n\nconformant — all phases delivered as planned.";

  it("includes ## Plan compliance review section", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      complianceReviewMd: complianceMd,
    });
    expect(output).toContain("## Plan compliance review");
  });

  it("contains the supplied compliance markdown verbatim", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      complianceReviewMd: complianceMd,
    });
    expect(output).toContain(complianceMd);
  });

  it("places ## Plan compliance review after ## Deviations not explained in any handoff", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      complianceReviewMd: complianceMd,
    });
    const deviationsIdx = output.indexOf("## Deviations not explained in any handoff");
    const complianceIdx = output.indexOf("## Plan compliance review");
    expect(deviationsIdx).toBeGreaterThanOrEqual(0);
    expect(complianceIdx).toBeGreaterThan(deviationsIdx);
  });

  it("places ## Plan compliance review before ## Phase details", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      complianceReviewMd: complianceMd,
    });
    const complianceIdx = output.indexOf("## Plan compliance review");
    const phaseDetailsIdx = output.indexOf("## Phase details");
    expect(complianceIdx).toBeGreaterThanOrEqual(0);
    expect(phaseDetailsIdx).toBeGreaterThan(complianceIdx);
  });

  it("sections are separated by exactly one blank line", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      complianceReviewMd: complianceMd,
    });
    // No triple newline anywhere (which would mean a double blank line)
    expect(output).not.toContain("\n\n\n");
  });

  it("with compliance differs from without compliance", () => {
    const without = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents);
    const withCompliance = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      complianceReviewMd: complianceMd,
    });
    expect(withCompliance).not.toBe(without);
  });
});

describe("buildReviewHandoffContent — source spec outcome", () => {
  const outcomes = {
    completed: "`docs/specs/archive/2609101270-demo.md` — completed on this branch (1f04e22)",
    blocked:
      "`docs/specs/2609101270-demo.md` — kept: live plans remain (docs/plans/2609101271-sibling-plan.md, Approved)",
    notCompleting:
      "`docs/specs/2609101270-demo.md` — kept: this plan does not complete it (completes-spec: false)",
  };

  for (const [name, outcome] of Object.entries(outcomes)) {
    it(`renders the ${name} outcome under ## Source spec`, () => {
      const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
        sourceSpecOutcomeMd: `${outcome}\n`,
      });
      expect(output).toContain(`## Source spec\n\n${outcome}\n`);
      expect(output).not.toContain("\n\n\n");
    });
  }

  it("places ## Source spec right after ## Run summary, before the global reconciliation", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents, {
      sourceSpecOutcomeMd: outcomes.notCompleting,
    });
    const summaryIdx = output.indexOf("## Run summary");
    const specIdx = output.indexOf("## Source spec");
    const globalIdx = output.indexOf("## Global File Reconciliation");
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(specIdx).toBeGreaterThan(summaryIdx);
    expect(globalIdx).toBeGreaterThan(specIdx);
  });

  it("renders no ## Source spec section when the outcome is absent", () => {
    const output = buildReviewHandoffContent(info, globalEmpty, globalMd, phaseContents);
    expect(output).not.toContain("## Source spec");
  });
});
