import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodePlanAuditResponse } from "../../../src/schemas/planAudit.js";

describe("PlanAuditResponseSchema", () => {
  it("decodes a response with two findings", () => {
    const result = decodePlanAuditResponse({
      findings: [
        { message: "a", phases: ["phase-01"] },
        { message: "b", phases: ["phase-01", "phase-02"] },
      ],
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.findings).toHaveLength(2);
    }
  });

  it("decodes an empty findings array", () => {
    const result = decodePlanAuditResponse({ findings: [] });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("decodes a finding with an empty phases array", () => {
    const result = decodePlanAuditResponse({ findings: [{ message: "a", phases: [] }] });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("rejects a finding missing message", () => {
    const result = decodePlanAuditResponse({ findings: [{ phases: ["phase-01"] }] });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a finding with an empty message", () => {
    const result = decodePlanAuditResponse({ findings: [{ message: "", phases: [] }] });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a finding with a non-string phase", () => {
    const result = decodePlanAuditResponse({ findings: [{ message: "a", phases: [1] }] });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("ignores an unknown top-level key", () => {
    const result = decodePlanAuditResponse({ findings: [], extra: true });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("rejects an empty object", () => {
    const result = decodePlanAuditResponse({});
    expect(Result.isFailure(result)).toBe(true);
  });
});
