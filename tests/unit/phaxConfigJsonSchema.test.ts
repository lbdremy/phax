import { describe, it, expect } from "vitest";
import { getPhaxConfigJsonSchema } from "../../src/schemas/phaxConfig.js";

describe("getPhaxConfigJsonSchema", () => {
  it("returns a JSON-serializable object", () => {
    const schema = getPhaxConfigJsonSchema();
    expect(() => JSON.stringify(schema)).not.toThrow();
  });

  it("has properties for all required top-level fields", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["version"]).toBeDefined();
    expect(properties["project"]).toBeDefined();
    expect(properties["state"]).toBeDefined();
    expect(properties["gateProfiles"]).toBeDefined();
  });

  it("lists all required top-level fields in required array", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const required = schema["required"] as string[];
    expect(Array.isArray(required)).toBe(true);
    for (const field of ["version", "project", "state", "gateProfiles"]) {
      expect(required).toContain(field);
    }
  });
});
