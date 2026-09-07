import { describe, expect, it } from "vitest";
import { diagnosticsPathFor, pendingPathFor } from "../../src/domain/gate/diagnosticsPath.js";

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

describe("pendingPathFor", () => {
  it("replaces a trailing .log with .pending.json", () => {
    expect(pendingPathFor("/runs/my-run/phase-01/checks-attempt-01.log")).toBe(
      "/runs/my-run/phase-01/checks-attempt-01.pending.json",
    );
  });

  it("keeps the padded attempt number in the name", () => {
    expect(pendingPathFor("checks-attempt-12.log")).toBe("checks-attempt-12.pending.json");
  });

  it("appends .pending.json when the path does not end in .log", () => {
    expect(pendingPathFor("checks-attempt-01")).toBe("checks-attempt-01.pending.json");
  });
});
