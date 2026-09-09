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

  it("has a description on orient.command mentioning whitespace and phax --usage", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    const orient = properties["orient"] as Record<string, unknown>;
    const orientDefs = orient["properties"] as Record<string, unknown> | undefined;
    const command = (orientDefs?.["command"] ?? orient) as Record<string, unknown>;
    const desc = command["description"] as string | undefined;
    expect(typeof desc).toBe("string");
    expect(desc).toContain("whitespace");
    expect(desc).toContain("phax --usage");
  });

  it("lists scopes.command as present, not required, with a description naming closed", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    const scopes = properties["scopes"] as Record<string, unknown>;
    expect(scopes).toBeDefined();
    const required = (schema["required"] as string[] | undefined) ?? [];
    expect(required).not.toContain("scopes");
    const scopesDefs = scopes["properties"] as Record<string, unknown> | undefined;
    const command = (scopesDefs?.["command"] ?? scopes) as Record<string, unknown>;
    const scopesRequired = (scopes["required"] as string[] | undefined) ?? [];
    expect(scopesRequired).toContain("command");
    const desc = command["description"] as string | undefined;
    expect(typeof desc).toBe("string");
    expect(desc).toContain("closed");
  });

  it("lists planAuditor.command as present, not required, with a description naming findings", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    const planAuditor = properties["planAuditor"] as Record<string, unknown>;
    expect(planAuditor).toBeDefined();
    const required = (schema["required"] as string[] | undefined) ?? [];
    expect(required).not.toContain("planAuditor");
    const planAuditorDefs = planAuditor["properties"] as Record<string, unknown> | undefined;
    const command = (planAuditorDefs?.["command"] ?? planAuditor) as Record<string, unknown>;
    const planAuditorRequired = (planAuditor["required"] as string[] | undefined) ?? [];
    expect(planAuditorRequired).toContain("command");
    const desc = command["description"] as string | undefined;
    expect(typeof desc).toBe("string");
    expect(desc).toContain("findings");
  });

  it("has a description on gate step output mentioning diagnostics shape and verdict rules", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const stepSchema = findGateStepSchema(schema);
    expect(stepSchema).toBeDefined();
    const properties = stepSchema?.["properties"] as Record<string, unknown>;
    const output = properties["output"] as Record<string, unknown>;
    const desc = output["description"] as string | undefined;
    expect(typeof desc).toBe("string");
    for (const token of [
      "diagnostics",
      "rule",
      "location",
      "file",
      "line",
      "message",
      "repair",
      "non-empty",
      "empty list",
      "provider error",
    ]) {
      expect(desc, `missing token: ${token}`).toContain(token);
    }
  });
});
