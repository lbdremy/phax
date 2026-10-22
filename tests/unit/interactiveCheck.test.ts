import { describe, expect, it } from "vitest";
import {
  interactiveFindings,
  type InteractiveCheckPhase,
} from "../../src/domain/plan/interactiveCheck.js";
import { readPhaseHeaders } from "../../src/domain/plan/phaseHeader.js";

function headersOf(headerLines: readonly string[], rest = "") {
  return readPhaseHeaders(
    [
      "# Plan",
      "",
      "## phase-01 — One {#a}",
      "",
      "**Recommended model:** m",
      "**Recommended effort:** low",
      ...headerLines,
      "",
      rest,
    ].join("\n"),
  );
}

// A plan of `count` phases; the listed ones carry `**Mode:** interactive`.
function planOf(count: number, interactive: readonly number[]) {
  return readPhaseHeaders(
    [
      "# Plan",
      "",
      ...Array.from({ length: count }, (_, i) => {
        const n = i + 1;
        return [
          `## phase-0${n} — Phase ${n} {#p${n}}`,
          "",
          "**Recommended model:** m",
          "**Recommended effort:** low",
          ...(interactive.includes(n) ? ["**Mode:** interactive"] : []),
          "",
          "Body.",
          "",
        ].join("\n");
      }),
    ].join("\n"),
  );
}

function phase(id: string, files: Partial<InteractiveCheckPhase> = {}): InteractiveCheckPhase {
  return { id, plannedFilesToCreate: [], plannedFilesToEdit: [], ...files };
}

const error = (phaseId: string, message: string) => ({
  severity: "error",
  check: "interactive",
  phase: phaseId,
  message,
});

describe("interactiveFindings — Mode lines", () => {
  it("gives nothing without a Mode line", () => {
    expect(interactiveFindings({ headers: headersOf([]), phases: null })).toEqual([]);
  });

  it("reports a Mode value other than interactive once, quoting it", () => {
    const findings = interactiveFindings({
      headers: headersOf(["**Mode:** review"]),
      phases: null,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ check: "interactive", phase: "phase-01" });
    expect(findings[0]!.message).toContain('"review"');
    expect(findings[0]!.message).toContain("headless phase carries no Mode line");
  });

  it("reports a headless Mode line as an error", () => {
    expect(
      interactiveFindings({ headers: headersOf(["**Mode:** headless"]), phases: null }),
    ).toHaveLength(1);
  });

  it("reports a repeated Mode line", () => {
    const repeated = readPhaseHeaders(
      [
        "## phase-01 — A {#a}",
        "",
        "Body.",
        "",
        "## phase-02 — B {#b}",
        "",
        "**Recommended model:** m",
        "**Mode:** interactive",
        "**Mode:** interactive",
        "",
        "## phase-03 — C {#c}",
        "",
        "Body.",
      ].join("\n"),
    );
    expect(interactiveFindings({ headers: repeated, phases: null })).toEqual([
      error("phase-02", "**Mode:** line appears more than once in the header paragraph"),
    ]);
  });

  it("reports a misplaced Mode line once", () => {
    const findings = interactiveFindings({
      headers: headersOf([], "**Mode:** interactive"),
      phases: null,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("outside the header paragraph");
  });
});

describe("interactiveFindings — placement", () => {
  it("accepts an interactive phase between two headless phases", () => {
    expect(interactiveFindings({ headers: planOf(3, [2]), phases: null })).toEqual([]);
  });

  it("refuses an interactive first phase", () => {
    expect(interactiveFindings({ headers: planOf(3, [1]), phases: null })).toEqual([
      error(
        "phase-01",
        "an interactive phase cannot be the first phase (no earlier phase has set a pattern to review)",
      ),
    ]);
  });

  it("refuses an interactive last phase", () => {
    expect(interactiveFindings({ headers: planOf(6, [6]), phases: null })).toEqual([
      error(
        "phase-06",
        "an interactive phase cannot be the last phase (the final phase is already kept open)",
      ),
    ]);
  });

  it("refuses an interactive phase that directly follows another", () => {
    expect(interactiveFindings({ headers: planOf(6, [3, 4]), phases: null })).toEqual([
      error("phase-04", "directly follows interactive phase-03"),
    ]);
  });

  it("reports the first and last rows before the following rows", () => {
    expect(
      interactiveFindings({ headers: planOf(6, [3, 4, 6]), phases: null }).map((f) => f.phase),
    ).toEqual(["phase-06", "phase-04"]);
  });

  it("refuses a one-phase interactive plan once, as the first phase", () => {
    expect(
      interactiveFindings({ headers: headersOf(["**Mode:** interactive"]), phases: null }),
    ).toEqual([
      error(
        "phase-01",
        "an interactive phase cannot be the first phase (no earlier phase has set a pattern to review)",
      ),
    ]);
  });
});

describe("interactiveFindings — planned work", () => {
  it("names each planned file of an interactive phase", () => {
    const phases = [
      phase("phase-01", { plannedFilesToEdit: ["src/export/port.ts"] }),
      phase("phase-02", {
        plannedFilesToCreate: ["src/export/labels.ts"],
        plannedFilesToEdit: ["src/export/csv.ts"],
      }),
      phase("phase-03", { plannedFilesToCreate: ["src/export/credit.ts"] }),
    ];
    expect(interactiveFindings({ headers: planOf(3, [2]), phases })).toEqual([
      error("phase-02", "plans src/export/labels.ts to create; an interactive phase plans no work"),
      error("phase-02", "plans src/export/csv.ts to edit; an interactive phase plans no work"),
    ]);
  });

  it("reports nothing for an interactive phase's optional files", () => {
    const phases = [phase("phase-01"), phase("phase-02"), phase("phase-03")];
    expect(interactiveFindings({ headers: planOf(3, [2]), phases })).toEqual([]);
  });

  it("reports nothing about planned work when the plan did not parse", () => {
    expect(interactiveFindings({ headers: planOf(3, [2]), phases: null })).toEqual([]);
  });

  it("orders Mode lines, placement, then planned work", () => {
    const headers = readPhaseHeaders(
      [
        "## phase-01 — A {#a}",
        "",
        "**Recommended model:** m",
        "**Mode:** interactive",
        "",
        "## phase-02 — B {#b}",
        "",
        "**Recommended model:** m",
        "**Mode:** review",
        "",
        "## phase-03 — C {#c}",
        "",
        "Body.",
      ].join("\n"),
    );
    const phases = [
      phase("phase-01", { plannedFilesToEdit: ["src/a.ts"] }),
      phase("phase-02"),
      phase("phase-03"),
    ];
    expect(interactiveFindings({ headers, phases }).map((f) => f.message)).toEqual([
      expect.stringContaining('"review" is not a mode'),
      expect.stringContaining("cannot be the first phase"),
      "plans src/a.ts to edit; an interactive phase plans no work",
    ]);
  });

  it("never says that an interactive phase cannot run yet", () => {
    const findings = interactiveFindings({
      headers: planOf(6, [1, 3, 4, 6]),
      phases: [phase("phase-03", { plannedFilesToEdit: ["src/x.ts"] })],
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.message).not.toMatch(/cannot run an interactive phase/);
  });
});
