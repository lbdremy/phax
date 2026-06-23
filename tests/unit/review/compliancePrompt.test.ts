import { describe, expect, it } from "vitest";
import {
  buildCompliancePrompt,
  COMPLIANCE_REVIEW_MD_FILENAME,
  COMPLIANCE_REVIEW_JSON_FILENAME,
} from "../../../src/domain/review/compliancePrompt.js";

const baseInput = {
  planMd: "# My Plan\n\nPhase 01 details here.",
  reconciliationMd: "## PHAX File Reconciliation\n\n### Planned to create\n- [x] src/foo.ts",
  phases: [
    { id: "phase-01", title: "Setup" },
    { id: "phase-02", title: "Core logic" },
  ],
  phaseHandoffs: [
    { phaseId: "phase-01", handoffMd: "## What was delivered\nSetup complete.\n" },
    { phaseId: "phase-02", handoffMd: "## What was delivered\nCore logic done.\n" },
  ],
  worktreePath: "/home/user/.phax/worktrees/my-run/phase-02",
  mdArtifactPath: "/home/user/.phax/worktrees/my-run/phase-02/.phax-context/compliance-review.md",
  jsonArtifactPath:
    "/home/user/.phax/worktrees/my-run/phase-02/.phax-context/compliance-review.json",
};

describe("buildCompliancePrompt", () => {
  it("includes the plan text", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("# My Plan");
    expect(prompt).toContain("Phase 01 details here.");
  });

  it("includes the reconciliation text", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("## PHAX File Reconciliation");
    expect(prompt).toContain("src/foo.ts");
  });

  it("includes both absolute artifact paths", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain(baseInput.mdArtifactPath);
    expect(prompt).toContain(baseInput.jsonArtifactPath);
  });

  it("includes per-phase instructions for every supplied phase", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("phase-01");
    expect(prompt).toContain("Setup");
    expect(prompt).toContain("phase-02");
    expect(prompt).toContain("Core logic");
  });

  it("embeds the verdict enum values", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("conformant");
    expect(prompt).toContain("conformant-with-deviations");
    expect(prompt).toContain("divergent");
  });

  it("embeds the severity enum values", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("info");
    expect(prompt).toContain("deviation");
    expect(prompt).toContain("concern");
  });

  it("embeds all dimension enum values", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("objective");
    expect(prompt).toContain("excluded-scope");
    expect(prompt).toContain("files");
    expect(prompt).toContain("tests");
    expect(prompt).toContain("boundaries");
    expect(prompt).toContain("commit");
    expect(prompt).toContain("handoff");
  });

  it("includes an explicit no-edit instruction", () => {
    const prompt = buildCompliancePrompt(baseInput);
    // Must instruct agent not to touch tracked source
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/do not (edit|modify|touch|change)/);
  });

  it("includes a conformance-only instruction", () => {
    const prompt = buildCompliancePrompt(baseInput);
    const lower = prompt.toLowerCase();
    expect(lower).toContain("conformance");
  });

  it("references the compliance-review.json shape (perPhase, findings)", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("perPhase");
    expect(prompt).toContain("findings");
  });

  it("references attentionPoints and pointers fields", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("attentionPoints");
    expect(prompt).toContain("pointers");
  });

  it("returns a single deterministic string for the same input", () => {
    const a = buildCompliancePrompt(baseInput);
    const b = buildCompliancePrompt(baseInput);
    expect(a).toBe(b);
  });

  it("includes each phase's handoffMd text verbatim", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("Setup complete.");
    expect(prompt).toContain("Core logic done.");
  });

  it("includes a per-phase handoff heading for each supplied phase", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("### Phase phase-01 handoff");
    expect(prompt).toContain("### Phase phase-02 handoff");
  });

  it("handoff dimension instruction references the inlined handoff, not a disk path", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain("inlined phase-handoff.md for this phase");
    expect(prompt).not.toMatch(/locate.*file.*disk/i);
  });

  it("places the Phase handoffs section after reconciliation and before per-phase instructions", () => {
    const prompt = buildCompliancePrompt(baseInput);
    const reconcPos = prompt.indexOf("## Global file reconciliation");
    const handoffsPos = prompt.indexOf("## Phase handoffs");
    const perPhasePos = prompt.indexOf("## Per-phase review instructions");
    expect(reconcPos).toBeLessThan(handoffsPos);
    expect(handoffsPos).toBeLessThan(perPhasePos);
  });

  it("handles empty phaseHandoffs without emitting a Phase handoffs section header", () => {
    const prompt = buildCompliancePrompt({ ...baseInput, phaseHandoffs: [] });
    expect(prompt).not.toContain("## Phase handoffs");
  });
});

describe("filename constants", () => {
  it("COMPLIANCE_REVIEW_MD_FILENAME is compliance-review.md", () => {
    expect(COMPLIANCE_REVIEW_MD_FILENAME).toBe("compliance-review.md");
  });

  it("COMPLIANCE_REVIEW_JSON_FILENAME is compliance-review.json", () => {
    expect(COMPLIANCE_REVIEW_JSON_FILENAME).toBe("compliance-review.json");
  });

  it("prompt names the MD filename constant", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain(COMPLIANCE_REVIEW_MD_FILENAME);
  });

  it("prompt names the JSON filename constant", () => {
    const prompt = buildCompliancePrompt(baseInput);
    expect(prompt).toContain(COMPLIANCE_REVIEW_JSON_FILENAME);
  });
});
