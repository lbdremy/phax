import { describe, expect, it } from "vitest";
import { parseReportName, reportPathFor } from "../../src/domain/gate/reportPath.js";

describe("reportPathFor", () => {
  it("replaces the log's .log with .report-SS.json, the step in two digits", () => {
    expect(reportPathFor("/runs/r/phase-01/checks-attempt-01.log", 1)).toBe(
      "/runs/r/phase-01/checks-attempt-01.report-01.json",
    );
    expect(reportPathFor("/runs/r/phase-01/checks-attempt-03.log", 12)).toBe(
      "/runs/r/phase-01/checks-attempt-03.report-12.json",
    );
  });

  it("appends .report-SS.json to a path that does not end in .log", () => {
    expect(reportPathFor("/runs/r/phase-01/checks", 2)).toBe(
      "/runs/r/phase-01/checks.report-02.json",
    );
  });
});

describe("parseReportName", () => {
  it("gives the attempt and the step of a saved report's name", () => {
    expect(parseReportName("checks-attempt-01.report-02.json")).toEqual({ attempt: 1, step: 2 });
    expect(parseReportName("checks-attempt-112.report-10.json")).toEqual({
      attempt: 112,
      step: 10,
    });
  });

  it("round-trips the base name reportPathFor gives", () => {
    const path = reportPathFor("/p/checks-attempt-04.log", 7);
    expect(parseReportName(path.slice(path.lastIndexOf("/") + 1))).toEqual({
      attempt: 4,
      step: 7,
    });
  });

  it("is undefined for any other name", () => {
    for (const name of [
      "checks-attempt-01.log",
      "checks-attempt-01.request.json",
      "checks-attempt-01.diagnostics.json",
      "checks-attempt-1.report-01.json",
      "checks-attempt-01.report-1.json",
      "checks-attempt-01.report-01.json.bak",
      "dir/checks-attempt-01.report-01.json",
      "brief-01.json",
    ]) {
      expect(parseReportName(name)).toBeUndefined();
    }
  });
});
