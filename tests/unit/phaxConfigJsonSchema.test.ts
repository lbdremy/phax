import { describe, it, expect } from "vitest";
import { getPhaxConfigJsonSchema } from "../../src/schemas/phaxConfig.js";

function findGateStepSchema(node: unknown): Record<string, unknown> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const record = node as Record<string, unknown>;
  const properties = record["properties"] as Record<string, unknown> | undefined;
  if (properties?.["output"] !== undefined) return record;
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === "object") {
      const found = findGateStepSchema(value);
      if (found) return found;
    }
  }
  return undefined;
}

describe("getPhaxConfigJsonSchema", () => {
  it("returns a JSON-serializable object", () => {
    const schema = getPhaxConfigJsonSchema();
    expect(() => JSON.stringify(schema)).not.toThrow();
  });

  it("has properties for all required top-level fields", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["version"]).toBeDefined();
    expect(properties["name"]).toBeDefined();
    expect(properties["state"]).toBeDefined();
    expect(properties["gateProfiles"]).toBeDefined();
  });

  it("lists all required top-level fields in required array", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const required = schema["required"] as string[];
    expect(Array.isArray(required)).toBe(true);
    for (const field of ["version", "name", "gateProfiles"]) {
      expect(required).toContain(field);
    }
    expect(required).not.toContain("state");
  });

  it("lists output on a gate step with the closed enum and does not require it", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const stepSchema = findGateStepSchema(schema);
    expect(stepSchema).toBeDefined();
    const properties = stepSchema?.["properties"] as Record<string, unknown>;
    expect(properties["output"]).toMatchObject({ enum: ["log", "diagnostics"] });
    const required = (stepSchema?.["required"] as string[] | undefined) ?? [];
    expect(required).not.toContain("output");
  });
});
