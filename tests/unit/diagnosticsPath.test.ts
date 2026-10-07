import { describe, expect, it } from "vitest";
import { diagnosticsPathFor } from "../../src/domain/gate/diagnosticsPath.js";

describe("diagnosticsPathFor", () => {
  it("replaces a trailing .log with .diagnostics.json", () => {
    expect(diagnosticsPathFor("/runs/my-run/phase-01/checks-attempt-01.log")).toBe(
      "/runs/my-run/phase-01/checks-attempt-01.diagnostics.json",
    );
  });

  it("keeps the padded attempt number in the name", () => {
    expect(diagnosticsPathFor("checks-attempt-12.log")).toBe("checks-attempt-12.diagnostics.json");
  });

  it("appends .diagnostics.json when the path does not end in .log", () => {
    expect(diagnosticsPathFor("checks-attempt-01")).toBe("checks-attempt-01.diagnostics.json");
  });
});
