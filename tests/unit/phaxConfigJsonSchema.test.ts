import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getPhaxConfigJsonSchema,
  getPhaxUserOverlayJsonSchema,
} from "../../src/schemas/phaxConfig.js";
import { withoutAnnotations } from "../../packages/schemas/build/equivalence.js";

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
    expect(properties["output"]).toMatchObject({ enum: ["log", "gate-report"] });
    const required = (stepSchema?.["required"] as string[] | undefined) ?? [];
    expect(required).not.toContain("output");
  });

  it("has exactly the contract's top-level properties in the project schema", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    expect(Object.keys(schema["properties"] as object).toSorted()).toEqual(
      [
        "$schema",
        "version",
        "name",
        "state",
        "agent",
        "commands",
        "fileReconciliation",
        "security",
        "publish",
        "brief",
        "planAuditor",
        "architecture",
        "acceptance",
        "review",
        "authoring",
        "gateProfiles",
        "workspaces",
        "records",
        "assignments",
        "protectedPaths",
      ].toSorted(),
    );
  });

  it("restates the glob dialect for the globs bound, and says where assignments are accepted", () => {
    const text = JSON.stringify(getPhaxConfigJsonSchema());
    expect(text).toContain(
      "The files the bound covers, as globs: working-tree-root-relative POSIX paths, matched case-sensitively",
    );
    expect(text).toContain("Accepted in phax.json only");
  });

  it("has exactly the contract's top-level properties in the user schema", () => {
    const schema = getPhaxUserOverlayJsonSchema() as Record<string, unknown>;
    expect(Object.keys(schema["properties"] as object).toSorted()).toEqual(
      [
        "state",
        "agent",
        "commands",
        "fileReconciliation",
        "security",
        "publish",
        "brief",
        "planAuditor",
        "architecture",
        "acceptance",
        "review",
        "authoring",
        "gateProfiles",
        "workspaces",
      ].toSorted(),
    );
    expect(Object.keys(schema["properties"] as object)).not.toContain("assignments");
    expect(Object.keys(schema["properties"] as object)).not.toContain("protectedPaths");
  });

  it.each([
    ["project", getPhaxConfigJsonSchema],
    ["user", getPhaxUserOverlayJsonSchema],
  ])(
    "describes the acceptance block in the %s schema: a required non-empty command, no other key",
    (_name, get) => {
      const schema = get() as Record<string, unknown>;
      const properties = schema["properties"] as Record<string, Record<string, unknown>>;
      expect(Object.keys(properties)).not.toContain("oracles");
      const acceptance = properties["acceptance"]!;
      expect(acceptance["description"]).toContain("acceptance provider");
      expect(Object.keys(acceptance["properties"] as object)).toEqual(["command"]);
      expect(acceptance["required"]).toEqual(["command"]);
      expect(acceptance["additionalProperties"]).toBe(false);
      const command = (acceptance["properties"] as Record<string, Record<string, unknown>>)[
        "command"
      ]!;
      expect(command["minLength"]).toBe(1);
      expect(command["description"]).toContain("acceptance request");
      expect(command["description"]).toContain("120 s");
    },
  );

  it("keeps the configured gate step surface to local, structural and product", () => {
    const stepSchema = findGateStepSchema(getPhaxConfigJsonSchema());
    expect(stepSchema).toBeDefined();
    const properties = stepSchema!["properties"] as Record<string, Record<string, unknown>>;
    const surface = properties["surface"]!;
    expect(surface["enum"]).toEqual(["local", "structural", "product"]);
  });

  it.each([
    ["project", getPhaxConfigJsonSchema],
    ["user", getPhaxUserOverlayJsonSchema],
  ])(
    "describes partial on a gate step in the %s schema: files and diff, at least one, no other key",
    (_name, get) => {
      const stepSchema = findGateStepSchema(get());
      expect(stepSchema).toBeDefined();
      const properties = stepSchema!["properties"] as Record<string, Record<string, unknown>>;
      const partial = properties["partial"]!;
      expect(partial).toBeDefined();
      expect(Object.keys(partial["properties"] as object).toSorted()).toEqual(["diff", "files"]);
      expect(partial["additionalProperties"]).toBe(false);
      expect(partial["anyOf"]).toEqual([{ required: ["files"] }, { required: ["diff"] }]);
      expect(partial["description"]).toContain("never runs them");
      const variants = partial["properties"] as Record<string, Record<string, unknown>>;
      expect(variants["files"]!["description"]).toContain("<files>");
      expect(variants["files"]!["minLength"]).toBe(1);
      expect(variants["diff"]!["description"]).toContain("no placeholder");
      expect(variants["diff"]!["minLength"]).toBe(1);
      expect((stepSchema!["required"] as string[]) ?? []).not.toContain("partial");
    },
  );

  it("commits root schema files equal to the generated ones", () => {
    const root = new URL("../../", import.meta.url).pathname;
    const committed = JSON.parse(readFileSync(join(root, "phax.schema.json"), "utf8"));
    const committedUser = JSON.parse(readFileSync(join(root, "phax.user.schema.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(getPhaxConfigJsonSchema())));
    expect(committedUser).toEqual(JSON.parse(JSON.stringify(getPhaxUserOverlayJsonSchema())));
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

  it("has a description on gate step output naming the gate report shape and verdict rules", () => {
    const schema = getPhaxConfigJsonSchema() as Record<string, unknown>;
    const stepSchema = findGateStepSchema(schema);
    expect(stepSchema).toBeDefined();
    const properties = stepSchema?.["properties"] as Record<string, unknown>;
    const output = properties["output"] as Record<string, unknown>;
    const desc = output["description"] as string | undefined;
    expect(typeof desc).toBe("string");
    for (const token of [
      "gate-report",
      "$schema",
      "https://docs.phax.run/schemas/gate-report/",
      "outcome",
      "checked",
      "findings",
      "review",
      "checks-attempt-NN.report-SS.json",
      "Any finding fails the step whatever the exit code",
      "empty list passes on exit 0",
      "broken step",
    ]) {
      expect(desc, `missing token: ${token}`).toContain(token);
    }
    for (const token of ["diagnostics", "scope", "closed", "pending"]) {
      expect(desc, `unexpected token: ${token}`).not.toContain(token);
    }
  });
});

// Effect 4 writes the editor schemas in another form than Effect 3 did (inline
// definitions, no generated descriptions, keys reordered). Their contract is
// 0.35.0's: the same once each `$ref` is written in place, annotations are
// dropped and `required` is read as a set.
function contract(schema: unknown): unknown {
  const document = schema as Record<string, unknown>;
  const defs = (document["$defs"] ?? {}) as Record<string, unknown>;
  const inline = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(inline);
    if (node === null || typeof node !== "object") return node;
    const { $ref, ...rest } = node as Record<string, unknown>;
    const entries = Object.entries(rest)
      .filter(
        ([key, value]) =>
          key !== "$defs" && !(key === "required" && Array.isArray(value) && value.length === 0),
      )
      .map(([key, value]) => [
        key,
        key === "required" && Array.isArray(value) ? value.toSorted() : inline(value),
      ]);
    const own = Object.fromEntries(entries) as Record<string, unknown>;
    return typeof $ref === "string"
      ? { ...(inline(defs[$ref.slice("#/$defs/".length)]) as object), ...own }
      : own;
  };
  return withoutAnnotations(inline(document));
}

describe("the editor schemas against 0.35.0's", () => {
  const fixtures = join(import.meta.dirname, "../fixtures/editorSchemas/0.35.0");

  it.each([
    ["phax.schema.json", getPhaxConfigJsonSchema],
    ["phax.user.schema.json", getPhaxUserOverlayJsonSchema],
  ] as const)("%s states 0.35.0's contract", (file, generate) => {
    const released = JSON.parse(readFileSync(join(fixtures, file), "utf8"));
    expect(contract(JSON.parse(JSON.stringify(generate())))).toEqual(contract(released));
  });
});
