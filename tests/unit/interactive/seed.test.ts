import { describe, expect, it } from "vitest";
import { buildDeclaredSeed, buildHeldSeed } from "../../../src/domain/interactive/seed.js";

const input = {
  shortName: "invoice-export",
  phaseId: "phase-03",
  phaseTitle: "Review the export record",
  detailedInstructions: "Review `InvoiceRow`: header wording, column order, missing tax id.",
  executed: [
    { id: "phase-01", title: "Export port", text: "## What was delivered\n- The port." },
    { id: "phase-02", title: "Invoice CSV record", text: "## What was delivered\n- InvoiceRow." },
  ],
  upcoming: [
    { id: "phase-04", title: "Credit-note CSV record", text: "Copy InvoiceRow for credit notes." },
    { id: "phase-05", title: "Payment CSV record", text: "Copy InvoiceRow for payments." },
  ],
  gateCommands: ["pnpm typecheck", "pnpm test:unit"],
  closeCommand: "phax resume invoice-export",
};

describe("buildDeclaredSeed", () => {
  const seed = buildDeclaredSeed(input);

  it("holds every section of the declared seed, in order", () => {
    const headings = [
      "# Interactive review: phase-03 of invoice-export",
      "## What is expected of you",
      "## What to review (plan, phase-03 — Review the export record)",
      "## Executed phases",
      "## Upcoming phases (their plan sections)",
      "Full plan: .phax-context/plan.md",
      "## Gate",
      "## Close the phase",
    ];
    const positions = headings.map((h) => seed.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions);
  });

  it("names why the run stopped and the later phases", () => {
    expect(seed).toContain("its plan declares this phase interactive");
    expect(seed).toContain("phase-04 and phase-05 start from what you leave here");
  });

  it("states what is expected of the person, including the optional handoff file", () => {
    expect(seed).toContain("Correct the pattern in this worktree");
    expect(seed).toContain("Turn each correction into a guard");
    expect(seed).toContain("Keep the scope");
    expect(seed).toContain(".phax-context/correction-handoff.md");
    expect(seed).toContain("## What was corrected");
    expect(seed).toContain("## Guards");
  });

  it("embeds the instructions, the handoffs and the upcoming sections", () => {
    expect(seed).toContain(input.detailedInstructions);
    expect(seed).toContain(
      "### phase-01 — Export port — handoff\n## What was delivered\n- The port.",
    );
    expect(seed).toContain("### phase-02 — Invoice CSV record — handoff");
    expect(seed).toContain(
      "### phase-04 — Credit-note CSV record\nCopy InvoiceRow for credit notes.",
    );
    expect(seed.indexOf("phase-01 — Export port")).toBeLessThan(seed.indexOf("phase-02 — Invoice"));
  });

  it("lists the gate commands and the close command from the main checkout", () => {
    expect(seed).toContain("## Gate\npnpm typecheck\npnpm test:unit\n");
    expect(seed).toContain(
      "## Close the phase\nFrom the main checkout, not from this worktree:\n  phax resume invoice-export\n",
    );
  });

  it("never tells an agent how to stop a run", () => {
    expect(seed).not.toMatch(
      /phax stop|abort|interrupt|ctrl-?c|SIGINT|kill |exit 13|stop the run/i,
    );
  });

  it("handles a first phase with nothing before and a last phase with nothing after", () => {
    const alone = buildDeclaredSeed({ ...input, executed: [], upcoming: [] });
    expect(alone).toContain("No phase follows it.");
    expect(alone).toContain("No phase has run before this one.");
    expect(alone).toContain("No phase follows this one.");
  });

  it("names a single later phase in the singular", () => {
    const one = buildDeclaredSeed({ ...input, upcoming: input.upcoming.slice(0, 1) });
    expect(one).toContain("phase-04 starts from what you leave here");
  });
});

const BASE = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const C2 = "5d6e7f8c0a91b2e4f6d8a0c2e4f6a8b0c2d4e6f8";

const heldInput = {
  shortName: "invoice-export",
  phaseId: "phase-02",
  phaseTitle: "Invoice CSV record",
  planSection: "## phase-02 — Invoice CSV record\n\n### Detailed instructions\n\nWrite InvoiceRow.",
  handoff: "## What was delivered\n- InvoiceRow with the `invoice_no` header.",
  reconciliation: "## PHAX File Reconciliation\n\n### Planned to create\n- [x] src/phase-02.ts",
  base: BASE,
  phaseCommit: C2,
  earlier: [{ id: "phase-01", title: "Export port", text: "## What was delivered\n- The port." }],
  upcoming: [
    { id: "phase-03", title: "Review the export record", text: "Review InvoiceRow." },
    { id: "phase-04", title: "Credit-note CSV record", text: "Copy InvoiceRow for credit notes." },
  ],
  gateCommands: ["pnpm typecheck", "pnpm test:unit"],
  closeCommand: "phax resume invoice-export",
};

describe("buildHeldSeed", () => {
  const seed = buildHeldSeed(heldInput);

  it("holds every part of the held seed, in order", () => {
    const parts = [
      "# Held for review: phase-02 of invoice-export",
      "started with --hold",
      "## What is expected of you",
      "## The phase (plan, phase-02)",
      "## What it delivered (its handoff)",
      "## Its files (reconciliation)",
      "## Earlier phases",
      "## Upcoming phases (their plan sections)",
      "Full plan: .phax-context/plan.md",
      "## Gate",
      "## Close the phase",
    ];
    const positions = parts.map((p) => seed.indexOf(p));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions);
  });

  it("names the phase commit on its base, and that the later phases have not started", () => {
    expect(seed).toContain("(5d6e7f8, on 1a2b3c4)");
    expect(seed).toContain("the later phases have not started");
  });

  it("asks for a review on top of the commit, guards, the scope and the optional handoff", () => {
    expect(seed).toContain("correct it in this worktree, on top of its commit");
    expect(seed).toContain("Turn each correction into a guard");
    expect(seed).toContain("Keep the scope");
    expect(seed).toContain(".phax-context/correction-handoff.md");
    expect(seed).toContain("## The pattern to follow from now on");
  });

  it("embeds the plan section, the handoff, the reconciliation and the other phases", () => {
    expect(seed).toContain(`## The phase (plan, phase-02)\n${heldInput.planSection}\n`);
    expect(seed).toContain(`## What it delivered (its handoff)\n${heldInput.handoff}\n`);
    expect(seed).toContain(`## Its files (reconciliation)\n${heldInput.reconciliation}\n`);
    expect(seed).toContain(
      "## Earlier phases\n### phase-01 — Export port — handoff\n## What was delivered\n- The port.",
    );
    expect(seed).toContain("### phase-03 — Review the export record\nReview InvoiceRow.");
    expect(seed).toContain("### phase-04 — Credit-note CSV record");
  });

  it("lists the gate commands and the close command from the main checkout", () => {
    expect(seed).toContain("## Gate\npnpm typecheck\npnpm test:unit\n");
    expect(seed).toContain(
      "## Close the phase\nFrom the main checkout, not from this worktree:\n  phax resume invoice-export\n",
    );
  });

  it("never tells anyone how to stop a run", () => {
    expect(seed).not.toMatch(
      /phax stop|abort|interrupt|ctrl-?c|SIGINT|kill |exit 13|stop the run/i,
    );
  });

  it("says so when no phase ran before it", () => {
    expect(buildHeldSeed({ ...heldInput, earlier: [] })).toContain(
      "## Earlier phases\nNo phase has run before this one.",
    );
  });
});
