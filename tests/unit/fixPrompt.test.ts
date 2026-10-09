import { describe, expect, it } from "vitest";
import { buildFixPrompt } from "../../src/domain/gate/fixPrompt.js";
import type { GateDiagnostic } from "../../src/schemas/gateDiagnostics.js";
import type { GateFinding } from "../../src/schemas/gateReport.js";

const baseInput = {
  command: "pnpm test",
  exitCode: 1,
  attempt: 2,
  logContent: "some log output",
  logPath: "/phase-01/checks-attempt-02.log",
  diagnostics: [] as readonly GateDiagnostic[],
  reportFindings: null,
};

// The spec's made-up checked example: two findings, the first with a related
// location and a guide, the second with neither.
const greetFinding: GateFinding = {
  id: "no-node-import src/greet.ts node:fs",
  rule: "a module under src/ imports no node: module",
  location: { file: "src/greet.ts", lines: [1, 1] },
  message: "imports node:fs",
  related: [{ file: "src/cli.ts", lines: [3, 5], why: "the caller, where the read belongs" }],
  guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
};
const farewellFinding: GateFinding = {
  id: "exports-function src/farewell.ts",
  rule: "a module under src/ exports its function",
  location: { file: "src/farewell.ts", lines: null },
  message: "no exported function",
  related: [],
  guide: null,
};

const reportInput = {
  ...baseInput,
  command: "node ./audit.mjs",
  exitCode: 0,
  reportFindings: { step: 1, findings: [greetFinding, farewellFinding] },
};

/** The prompt's Markdown headings, in order. */
function headings(prompt: string): string[] {
  return prompt.split("\n").filter((line) => line.startsWith("#"));
}

describe("buildFixPrompt", () => {
  it("renders the raw-log prompt when there are no diagnostics", () => {
    const prompt = buildFixPrompt(baseInput);

    expect(prompt).toContain("# Gate checks failed — fix required");
    expect(prompt).toContain("Gate run (attempt 2) failed.");
    expect(prompt).toContain("**Failed command:** `pnpm test`");
    expect(prompt).toContain("**Exit code:** 1");
    expect(prompt).toContain("## Gate output");
    expect(prompt).toContain("some log output");
    expect(prompt).toContain("Fix all issues revealed by the gate output above.");
    expect(prompt).not.toContain("## Diagnostics");
    expect(prompt).not.toContain("repair guide:");
  });

  it("renders file:line for a diagnostic with a line", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "no-unused-vars",
        class: "invariant",
        location: { file: "src/foo.ts", line: 12 },
        message: "unused variable 'x'",
        repair: "remove the unused declaration",
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics });

    expect(prompt).toContain("## Diagnostics");
    expect(prompt).toContain("no-unused-vars at src/foo.ts:12 — unused variable 'x'");
    expect(prompt).toContain("repair guide: remove the unused declaration");
  });

  it("renders file only for a diagnostic without a line", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "missing-license",
        class: "invariant",
        location: { file: "package.json" },
        message: "license field is missing",
        repair: "add a license field",
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics });

    expect(prompt).toContain("missing-license at package.json — license field is missing");
  });

  it("tells the agent to read repair guides before changing code and omits the raw log", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "no-unused-vars",
        class: "invariant",
        location: { file: "src/foo.ts", line: 12 },
        message: "unused variable 'x'",
        repair: "remove the unused declaration",
      },
    ];

    const prompt = buildFixPrompt({ ...baseInput, diagnostics });

    expect(prompt).toContain(
      "Read each repair guide above before changing code, then fix every diagnostic listed under **Diagnostics**.",
    );
    expect(prompt).not.toContain("## Gate output");
    expect(prompt).not.toContain("some log output");
    expect(prompt).toContain(`Full output: ${baseInput.logPath}`);
    expect(prompt).toContain("**Failed step:** `pnpm test` (1 diagnostic(s))");
  });

  it("renders a completion then an invariant in provider order, exactly as two failing findings", () => {
    const completion: GateDiagnostic = {
      rule: "missing-wiring",
      class: "completion",
      location: { file: "src/core/billing/port.ts" },
      message: "billing port is not wired up",
      repair: "wire the port into the adapter registry",
    };
    const invariant: GateDiagnostic = {
      rule: "no-unused-vars",
      class: "invariant",
      location: { file: "src/foo.ts", line: 12 },
      message: "unused variable 'x'",
      repair: "remove the unused declaration",
    };

    const prompt = buildFixPrompt({ ...baseInput, diagnostics: [completion, invariant] });

    const start = prompt.indexOf("## Diagnostics");
    const end = prompt.indexOf("## Required action");
    expect(prompt.slice(start, end)).toBe(
      [
        "## Diagnostics",
        "",
        "- missing-wiring at src/core/billing/port.ts — billing port is not wired up",
        "  repair guide: wire the port into the adapter registry",
        "- no-unused-vars at src/foo.ts:12 — unused variable 'x'",
        "  repair guide: remove the unused declaration",
        "",
        `Full output: ${baseInput.logPath}`,
        "",
        "",
      ].join("\n"),
    );
    expect(prompt).toContain("**Failed step:** `pnpm test` (2 diagnostic(s))");
  });

  it("has no section beyond the gate output or diagnostics and the required action, in either prompt", () => {
    const diagnostics: readonly GateDiagnostic[] = [
      {
        rule: "missing-wiring",
        class: "completion",
        location: { file: "src/core/billing/port.ts" },
        message: "billing port is not wired up",
        repair: "wire the port into the adapter registry",
      },
    ];

    expect(headings(buildFixPrompt(baseInput))).toEqual([
      "# Gate checks failed — fix required",
      "## Gate output",
      "## Required action",
    ]);
    const withDiagnostics = buildFixPrompt({ ...baseInput, diagnostics });
    expect(headings(withDiagnostics)).toEqual([
      "# Gate checks failed — fix required",
      "## Diagnostics",
      "## Required action",
    ]);
    expect(withDiagnostics).not.toMatch(/optional/i);
  });
});

describe("buildFixPrompt for a failing gate report", () => {
  it("shows each finding in the report's order with its rule, location, related locations and guide", () => {
    const prompt = buildFixPrompt(reportInput);

    expect(prompt).toBe(
      [
        "# Gate checks failed — fix required",
        "",
        "Gate run (attempt 2) failed.",
        "",
        "**Failed step:** `node ./audit.mjs` (2 findings)",
        "",
        "## Findings",
        "",
        "- src/greet.ts:1",
        "  rule: a module under src/ imports no node: module",
        "  found: imports node:fs",
        "  also involves src/cli.ts:3-5 — the caller, where the read belongs",
        "  guide: keep I/O in the module's caller. Read guides/no-node-import.md and follow it.",
        "- src/farewell.ts",
        "  rule: a module under src/ exports its function",
        "  found: no exported function",
        "",
        `Full output: ${baseInput.logPath}`,
        "",
        "## Required action",
        "",
        "Read the file each guide names before changing code, then fix every finding under **Findings**.",
        "Make the minimum changes required to pass the gate.",
        "Do not change unrelated code or introduce new features.",
        "",
        "Make sure to run the failed command after your changes to verify the gate now passes.",
        "The gate run will be re-attempted automatically after your changes.",
      ].join("\n"),
    );
  });

  it("keeps the report's order, whatever it is", () => {
    const prompt = buildFixPrompt({
      ...reportInput,
      reportFindings: { step: 1, findings: [farewellFinding, greetFinding] },
    });

    expect(prompt.indexOf("- src/farewell.ts")).toBeLessThan(prompt.indexOf("- src/greet.ts:1"));
  });

  it("gives a finding whose guide is null no guide line", () => {
    const prompt = buildFixPrompt({
      ...reportInput,
      reportFindings: { step: 1, findings: [farewellFinding] },
    });

    expect(prompt).toContain("**Failed step:** `node ./audit.mjs` (1 finding)");
    expect(prompt).not.toContain("guide:");
  });

  it("renders a location as file, file:N or file:N-M", () => {
    const prompt = buildFixPrompt({
      ...reportInput,
      reportFindings: {
        step: 1,
        findings: [
          { ...farewellFinding, id: "a", location: { file: "src/a.ts", lines: null } },
          { ...farewellFinding, id: "b", location: { file: "src/b.ts", lines: [7, 7] } },
          { ...farewellFinding, id: "c", location: { file: "src/c.ts", lines: [2, 9] } },
        ],
      },
    });

    expect(prompt).toContain("- src/a.ts\n");
    expect(prompt).toContain("- src/b.ts:7\n");
    expect(prompt).toContain("- src/c.ts:2-9\n");
  });

  it("shows no finding id, no raw log and no gate output", () => {
    const prompt = buildFixPrompt(reportInput);

    expect(prompt).not.toContain(greetFinding.id);
    expect(prompt).not.toContain(farewellFinding.id);
    expect(prompt).not.toContain("some log output");
    expect(headings(prompt)).toEqual([
      "# Gate checks failed — fix required",
      "## Findings",
      "## Required action",
    ]);
  });

  it("tells the agent to read the guide's file without pasting it", () => {
    const prompt = buildFixPrompt(reportInput);

    expect(prompt).toContain("Read guides/no-node-import.md and follow it.");
    expect(prompt.split("guides/no-node-import.md")).toHaveLength(2);
  });
});
