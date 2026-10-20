import { describe, expect, it } from "vitest";
import { oracleFindings, unsupportedOracleFindings } from "../../src/domain/plan/oracleCheck.js";
import { readPhaseHeaders } from "../../src/domain/plan/phaseHeader.js";

function findingsOf(headerLines: readonly string[], rest = "") {
  return oracleFindings(
    readPhaseHeaders(
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
    ),
  );
}

describe("unsupportedOracleFindings", () => {
  it("skips a phase whose declaration is malformed", () => {
    const headers = readPhaseHeaders(
      [
        "# Plan",
        "",
        "## phase-01 — One {#a}",
        "",
        "**Recommended model:** m",
        "**Recommended effort:** low",
        "**Oracle phase:** yes",
        "",
      ].join("\n"),
    );
    expect(unsupportedOracleFindings(headers)).toEqual([]);
  });
});

describe("oracleFindings", () => {
  it("gives nothing without an oracle line", () => {
    expect(findingsOf([])).toEqual([]);
  });

  it.each([
    ["yes", "**Oracle phase:** yes"],
    ["discharged by phase-04", "**Oracle phase:** discharged by phase-04"],
  ])("refuses a well-formed %s declaration as not supported yet", (_name, line) => {
    expect(findingsOf([line, "**Oracle files:** `a.ts`"])).toEqual([
      {
        severity: "error",
        check: "oracles",
        phase: "phase-01",
        message:
          "declared an oracle phase (**Oracle phase:**): this phax cannot run an oracle phase yet; remove the oracle lines",
      },
    ]);
  });

  it.each([
    [
      "Oracle phase without Oracle files",
      ["**Oracle phase:** yes"],
      "",
      "**Oracle phase:** without **Oracle files:**",
    ],
    [
      "Oracle files without Oracle phase",
      ["**Oracle files:** a.ts"],
      "",
      "**Oracle files:** without **Oracle phase:**",
    ],
    [
      "an unknown Oracle phase value",
      ["**Oracle phase:** maybe", "**Oracle files:** a.ts"],
      "",
      '"maybe"',
    ],
    [
      "Oracle files outside the header",
      ["**Oracle phase:** yes"],
      "**Oracle files:** a.ts",
      "**Oracle files:** line sits outside",
    ],
    [
      "Oracle phase outside the header",
      ["**Oracle files:** a.ts"],
      "**Oracle phase:** yes",
      "**Oracle phase:** line sits outside",
    ],
    [
      "a repeated Oracle phase line",
      ["**Oracle phase:** yes", "**Oracle phase:** yes", "**Oracle files:** a.ts"],
      "",
      "**Oracle phase:** line appears more than once",
    ],
    [
      "a repeated Oracle files line",
      ["**Oracle phase:** yes", "**Oracle files:** a.ts", "**Oracle files:** b.ts"],
      "",
      "**Oracle files:** line appears more than once",
    ],
  ])("gives exactly one error for %s", (_name, header, rest, fragment) => {
    const findings = findingsOf(header, rest);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "error", check: "oracles", phase: "phase-01" });
    expect(findings[0]!.message).toContain(fragment);
  });
});
