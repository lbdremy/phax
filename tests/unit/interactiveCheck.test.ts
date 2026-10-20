import { describe, expect, it } from "vitest";
import {
  interactiveFindings,
  unsupportedInteractiveFindings,
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

describe("interactiveFindings", () => {
  it("gives nothing without a Mode line", () => {
    expect(interactiveFindings(headersOf([]))).toEqual([]);
  });

  it("refuses a well-formed interactive declaration as not supported yet", () => {
    expect(interactiveFindings(headersOf(["**Mode:** interactive"]))).toEqual([
      {
        severity: "error",
        check: "interactive",
        phase: "phase-01",
        message:
          "declared interactive (**Mode:** interactive): this phax cannot run an interactive phase yet; remove the line",
      },
    ]);
  });

  it("reports a Mode value other than interactive once, quoting it", () => {
    const findings = interactiveFindings(headersOf(["**Mode:** review"]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ check: "interactive", phase: "phase-01" });
    expect(findings[0]!.message).toContain('"review"');
    expect(findings[0]!.message).toContain("headless phase carries no Mode line");
  });

  it("reports a headless Mode line as an error", () => {
    expect(interactiveFindings(headersOf(["**Mode:** headless"]))).toHaveLength(1);
  });

  it("reports a repeated Mode line once, without the not-supported error", () => {
    const findings = interactiveFindings(
      headersOf(["**Mode:** interactive", "**Mode:** interactive"]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("more than once");
  });

  it("reports a misplaced Mode line once", () => {
    const findings = interactiveFindings(headersOf([], "**Mode:** interactive"));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("outside the header paragraph");
  });
});

describe("unsupportedInteractiveFindings", () => {
  it("skips a phase with another interactive defect", () => {
    expect(unsupportedInteractiveFindings(headersOf(["**Mode:** interactive"], "Mode: x"))).toEqual(
      [],
    );
  });
});
