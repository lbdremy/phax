import { describe, expect, it } from "vitest";
import { buildDeclaredSeed } from "../../../src/domain/interactive/seed.js";

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
