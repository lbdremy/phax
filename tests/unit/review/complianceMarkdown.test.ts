import { describe, expect, it } from "vitest";
import {
  renderComplianceReviewMarkdown,
  type ComplianceReviewToRender,
} from "../../../src/domain/review/complianceMarkdown.js";

const RUN_ID = "notebook.audio-export";

const golden: ComplianceReviewToRender = {
  verdict: "conformant-with-deviations",
  summary: "All four phases delivered; phase-02 skipped one promised test.",
  perPhase: [
    { phaseId: "phase-01", verdict: "conformant", findings: [] },
    {
      phaseId: "phase-02",
      verdict: "conformant-with-deviations",
      findings: [
        {
          dimension: "tests",
          severity: "deviation",
          message: "The promised integration test for export retries is missing.",
        },
      ],
    },
  ],
  unplannedChanges: [
    {
      phaseId: "phase-02",
      path: "src/export/backoff.ts",
      note: "Shared helper, justified in the handoff.",
    },
  ],
  unmetPromises: [
    {
      phaseId: "phase-02",
      promise: "integration test: export retries on 503",
      note: "Not found in tests/integration.",
    },
  ],
  attentionPoints: ["Confirm the retry backoff with the audio team."],
  pointers: [],
};

const goldenMarkdown = [
  "# Compliance review — notebook.audio-export",
  "",
  "Verdict: conformant-with-deviations",
  "",
  "All four phases delivered; phase-02 skipped one promised test.",
  "",
  "## phase-01 — conformant",
  "",
  "None.",
  "",
  "## phase-02 — conformant-with-deviations",
  "",
  "- tests · deviation — The promised integration test for export retries is missing.",
  "",
  "## Unplanned changes",
  "",
  "- phase-02 · src/export/backoff.ts — Shared helper, justified in the handoff.",
  "",
  "## Unmet promises",
  "",
  "- phase-02 · integration test: export retries on 503 — Not found in tests/integration.",
  "",
  "## Attention points",
  "",
  "- Confirm the retry backoff with the audio team.",
  "",
  "## Pointers",
  "",
  "None.",
  "",
].join("\n");

describe("renderComplianceReviewMarkdown", () => {
  it.fails("renders the golden review exactly", () => {
    expect(renderComplianceReviewMarkdown(RUN_ID, golden)).toBe(goldenMarkdown);
  });

  it.fails("renders the same review identically twice", () => {
    expect(renderComplianceReviewMarkdown(RUN_ID, golden)).toBe(
      renderComplianceReviewMarkdown(RUN_ID, golden),
    );
  });

  it.fails.each([{ summary: "" }, { summary: "  \n " }])(
    "renders None. everywhere for an empty review (summary $summary)",
    ({ summary }) => {
      const review: ComplianceReviewToRender = {
        verdict: "conformant",
        summary,
        perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [] }],
        unplannedChanges: [],
        unmetPromises: [],
        attentionPoints: [],
        pointers: [],
      };
      expect(renderComplianceReviewMarkdown(RUN_ID, review)).toBe(
        [
          "# Compliance review — notebook.audio-export",
          "",
          "Verdict: conformant",
          "",
          "None.",
          "",
          "## phase-01 — conformant",
          "",
          "None.",
          "",
          "## Unplanned changes",
          "",
          "None.",
          "",
          "## Unmet promises",
          "",
          "None.",
          "",
          "## Attention points",
          "",
          "None.",
          "",
          "## Pointers",
          "",
          "None.",
          "",
        ].join("\n"),
      );
    },
  );

  it.fails("keeps the answer's order for findings and ledger entries", () => {
    const review: ComplianceReviewToRender = {
      verdict: "non-conformant",
      summary: "Two of everything.",
      perPhase: [
        {
          phaseId: "phase-01",
          verdict: "non-conformant",
          findings: [
            { dimension: "scope", severity: "major", message: "Second dimension first." },
            { dimension: "tests", severity: "minor", message: "First dimension second." },
          ],
        },
      ],
      unplannedChanges: [
        { phaseId: "phase-01", path: "z.ts", note: "z" },
        { phaseId: "phase-01", path: "a.ts", note: "a" },
      ],
      unmetPromises: [
        { phaseId: "phase-01", promise: "zeta", note: "z" },
        { phaseId: "phase-01", promise: "alpha", note: "a" },
      ],
      attentionPoints: [],
      pointers: [],
    };
    expect(renderComplianceReviewMarkdown(RUN_ID, review)).toBe(
      [
        "# Compliance review — notebook.audio-export",
        "",
        "Verdict: non-conformant",
        "",
        "Two of everything.",
        "",
        "## phase-01 — non-conformant",
        "",
        "- scope · major — Second dimension first.",
        "- tests · minor — First dimension second.",
        "",
        "## Unplanned changes",
        "",
        "- phase-01 · z.ts — z",
        "- phase-01 · a.ts — a",
        "",
        "## Unmet promises",
        "",
        "- phase-01 · zeta — z",
        "- phase-01 · alpha — a",
        "",
        "## Attention points",
        "",
        "None.",
        "",
        "## Pointers",
        "",
        "None.",
        "",
      ].join("\n"),
    );
  });
});
