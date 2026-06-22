import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ComplianceReviewConfigSchema,
  resolveComplianceReviewConfig,
  decodePhaxConfig,
  getPhaxConfigJsonSchema,
  DEFAULT_COMPLIANCE_REVIEW_MODEL,
} from "../../../src/schemas/phaxConfig.js";

const decodeComplianceReviewConfig = Schema.decodeUnknownEither(ComplianceReviewConfigSchema, {
  onExcessProperty: "error",
});

const minimalValidPhaxConfig = {
  version: 1,
  project: { name: "test", type: "single-package" },
  state: { root: ".phax" },
  gateProfiles: { full: ["pnpm test"] },
} as const;

describe("ComplianceReviewConfigSchema", () => {
  it("decodes a full compliance review config", () => {
    const result = decodeComplianceReviewConfig({
      enabled: true,
      model: "claude-opus-4-8",
      effort: "high",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.enabled).toBe(true);
      expect(result.right.model).toBe("claude-opus-4-8");
      expect(result.right.effort).toBe("high");
    }
  });

  it("decodes a minimal compliance review config (only enabled)", () => {
    const result = decodeComplianceReviewConfig({ enabled: false });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.enabled).toBe(false);
      expect(result.right.model).toBeUndefined();
      expect(result.right.effort).toBeUndefined();
    }
  });

  it("rejects an invalid effort value", () => {
    const result = decodeComplianceReviewConfig({ enabled: true, effort: "xhigh" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = decodeComplianceReviewConfig({ enabled: true, bogus: "value" });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("resolveComplianceReviewConfig", () => {
  it("returns disabled defaults when undefined", () => {
    const resolved = resolveComplianceReviewConfig(undefined);
    expect(resolved.enabled).toBe(false);
    expect(resolved.model).toBe(DEFAULT_COMPLIANCE_REVIEW_MODEL);
    expect(resolved.effort).toBe("medium");
  });

  it("applies defaults for missing optional fields", () => {
    const resolved = resolveComplianceReviewConfig({ enabled: true });
    expect(resolved.enabled).toBe(true);
    expect(resolved.model).toBe(DEFAULT_COMPLIANCE_REVIEW_MODEL);
    expect(resolved.effort).toBe("medium");
  });

  it("preserves all provided fields", () => {
    const resolved = resolveComplianceReviewConfig({
      enabled: true,
      model: "claude-opus-4-8",
      effort: "high",
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.model).toBe("claude-opus-4-8");
    expect(resolved.effort).toBe("high");
  });
});

describe("PhaxConfigSchema with review.compliance block", () => {
  it("decodes phax.json with review.compliance block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      review: { compliance: { enabled: true, model: "claude-opus-4-8" } },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.review?.compliance?.enabled).toBe(true);
    }
  });

  it("decodes phax.json without review block", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.review).toBeUndefined();
    }
  });

  it("rejects unknown key under review.compliance", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      review: { compliance: { enabled: true, bogus: "value" } },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects invalid effort under review.compliance", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      review: { compliance: { enabled: true, effort: "xhigh" } },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("getPhaxConfigJsonSchema with review.compliance", () => {
  it("includes review.compliance properties in the JSON schema", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const schemaStr = JSON.stringify(schema);
    expect(schemaStr).toContain("compliance");
  });
});
