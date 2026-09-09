import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  PlanAuditorConfigSchema,
  decodePhaxConfig,
  decodePhaxUserOverlay,
} from "../../../src/schemas/phaxConfig.js";

const decodePlanAuditorConfig = Schema.decodeUnknownEither(PlanAuditorConfigSchema, {
  onExcessProperty: "error",
});

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  gateProfiles: { full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
} as const;

describe("PlanAuditorConfigSchema", () => {
  it("decodes a valid planAuditor block", () => {
    const result = decodePlanAuditorConfig({ command: "audit-plan" });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.command).toBe("audit-plan");
    }
  });

  it("rejects an empty command", () => {
    const result = decodePlanAuditorConfig({ command: "" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the block", () => {
    const result = decodePlanAuditorConfig({ command: "audit-plan", extra: "value" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a planAuditor block without a command", () => {
    const result = decodePlanAuditorConfig({});
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxConfigSchema planAuditor block", () => {
  it("decodes a config with a planAuditor block next to orient and scopes", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      orient: { command: "orient-provider" },
      scopes: { command: "scopes-provider" },
      planAuditor: { command: "audit-plan" },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.planAuditor?.command).toBe("audit-plan");
    }
  });

  it("resolves to undefined when the planAuditor block is absent", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.planAuditor).toBeUndefined();
    }
  });

  it("rejects an empty command in the planAuditor block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      planAuditor: { command: "" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a planAuditor block without a command", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      planAuditor: {},
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the planAuditor block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      planAuditor: { command: "audit-plan", extra: "value" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxUserOverlaySchema planAuditor block", () => {
  it("decodes an overlay with a planAuditor block", () => {
    const result = decodePhaxUserOverlay({ planAuditor: { command: "audit-plan" } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.planAuditor?.command).toBe("audit-plan");
    }
  });

  it("resolves to undefined when the planAuditor block is absent", () => {
    const result = decodePhaxUserOverlay({});
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.planAuditor).toBeUndefined();
    }
  });

  it("rejects an empty command in the overlay planAuditor block", () => {
    const result = decodePhaxUserOverlay({ planAuditor: { command: "" } });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an overlay planAuditor block without a command", () => {
    const result = decodePhaxUserOverlay({ planAuditor: {} });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the overlay planAuditor block", () => {
    const result = decodePhaxUserOverlay({
      planAuditor: { command: "audit-plan", extra: "value" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
