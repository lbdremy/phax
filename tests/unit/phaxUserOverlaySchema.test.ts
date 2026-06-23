import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodePhaxUserOverlay,
  getPhaxUserOverlayJsonSchema,
} from "../../src/schemas/phaxConfig.js";

describe("decodePhaxUserOverlay", () => {
  it("accepts an empty object", () => {
    const result = decodePhaxUserOverlay({});
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts only state.root", () => {
    const result = decodePhaxUserOverlay({ state: { root: "~/.mystate" } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.state?.root).toBe("~/.mystate");
    }
  });

  it("accepts only security.profile", () => {
    const result = decodePhaxUserOverlay({ security: { profile: "unsafe" } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security?.profile).toBe("unsafe");
    }
  });

  it("accepts a partial agent block", () => {
    const result = decodePhaxUserOverlay({ agent: { maxFixAttempts: 3 } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.agent?.maxFixAttempts).toBe(3);
    }
  });

  it("accepts agent.extractPlan with model and effort", () => {
    const result = decodePhaxUserOverlay({
      agent: { extractPlan: { model: "claude-sonnet-4-6", effort: "high" } },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.agent?.extractPlan?.model).toBe("claude-sonnet-4-6");
      expect(result.right.agent?.extractPlan?.effort).toBe("high");
    }
  });

  it("accepts gateProfiles", () => {
    const result = decodePhaxUserOverlay({
      gateProfiles: { fast: ["pnpm test:unit"] },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a full overlay with multiple fields", () => {
    const result = decodePhaxUserOverlay({
      state: { root: "~/.mystate" },
      agent: { maxFixAttempts: 2, extractPlan: { effort: "medium" } },
      security: { profile: "secure", filesystem: { allowWrite: ["dist/"] } },
      fileReconciliation: { mode: "warn" },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects an overlay carrying version", () => {
    const result = decodePhaxUserOverlay({ version: 1 });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an overlay carrying name", () => {
    const result = decodePhaxUserOverlay({ name: "myproject" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an overlay carrying $schema", () => {
    const result = decodePhaxUserOverlay({ $schema: "./phax.schema.json" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an overlay with an unknown excess property", () => {
    const result = decodePhaxUserOverlay({ unknownField: "value" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid agent.maxFixAttempts value (out of range)", () => {
    const result = decodePhaxUserOverlay({ agent: { maxFixAttempts: 0 } });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid security profile value", () => {
    const result = decodePhaxUserOverlay({ security: { profile: "super-safe" } });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("getPhaxUserOverlayJsonSchema", () => {
  it("returns a JSON-serializable object", () => {
    const schema = getPhaxUserOverlayJsonSchema();
    expect(() => JSON.stringify(schema)).not.toThrow();
  });

  it("does not include version, name, or $schema in properties", () => {
    const schema = getPhaxUserOverlayJsonSchema() as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["version"]).toBeUndefined();
    expect(properties["name"]).toBeUndefined();
    expect(properties["$schema"]).toBeUndefined();
  });

  it("includes overridable fields in properties", () => {
    const schema = getPhaxUserOverlayJsonSchema() as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["state"]).toBeDefined();
    expect(properties["agent"]).toBeDefined();
    expect(properties["security"]).toBeDefined();
    expect(properties["gateProfiles"]).toBeDefined();
  });

  it("has no required fields at the top level", () => {
    const schema = getPhaxUserOverlayJsonSchema() as Record<string, unknown>;
    const required = schema["required"] as string[] | undefined;
    expect(!required || required.length === 0).toBe(true);
  });
});
