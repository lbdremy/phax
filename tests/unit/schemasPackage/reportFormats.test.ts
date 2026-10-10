// The two reports in the package: parseGateReport and parseBriefReport read
// the spec's §6 examples, and the two built JSON Schemas share one location,
// related location, guide and finding definition, refusing unknown keys in
// every object. Every document is made up.
import { describe, expect, it } from "vitest";
import {
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../../../packages/schemas/build/jsonSchemas.js";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import {
  parseBriefReport,
  parseDocument,
  parseGateReport,
  toLatestBriefReport,
  toLatestGateReport,
} from "../../../packages/schemas/src/index.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";

const GUIDE = { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" };

const greetFinding = {
  id: "no-node-import src/greet.ts node:fs",
  rule: "a module under src/ imports no node: module",
  location: { file: "src/greet.ts", lines: [1, 1] },
  message: "imports node:fs",
  related: [{ file: "src/cli.ts", lines: [3, 5], why: "the caller, where the read belongs" }],
  guide: GUIDE,
};

const farewellFinding = {
  id: "exports-function src/farewell.ts",
  rule: "a module under src/ exports its function",
  location: { file: "src/farewell.ts", lines: null },
  message: "no exported function",
  related: [],
  guide: null,
};

const checkedReport = {
  $schema: currentSchemaUrl("gate-report"),
  outcome: "checked",
  findings: [greetFinding, farewellFinding],
  review: [
    { owner: "hw-maintainers", note: "whether 'Hello, <name>!' is the greeting the product wants" },
  ],
};

const refusedReport = {
  $schema: currentSchemaUrl("gate-report"),
  outcome: "refused",
  reason: "the checks need hw-rules 2, and 1 is installed",
  remedy: "pnpm add -D hw-rules@2",
};

const briefReport = {
  $schema: currentSchemaUrl("brief-report"),
  rules: [
    {
      rule: "a module under src/ exports its function",
      files: ["src/greet.ts", "src/farewell.ts"],
      guide: null,
    },
    {
      rule: "a module under src/ imports no node: module",
      files: ["src/greet.ts", "src/farewell.ts"],
      guide: GUIDE,
    },
  ],
  findings: [
    { ...greetFinding, related: [], due: "this-phase" },
    { ...farewellFinding, due: "later" },
  ],
};

describe("the package reads both reports", () => {
  it.each([
    ["the checked gate report", checkedReport],
    ["the refused gate report", refusedReport],
  ])("parseGateReport reads %s at its current shape", (_name, document) => {
    expect(parseGateReport(document)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES["gate-report"],
      value: document,
    });
    expect(parseDocument(document)).toMatchObject({ ok: true, format: "gate-report" });
  });

  it("parseBriefReport reads the brief report at its current shape", () => {
    expect(parseBriefReport(briefReport)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES["brief-report"],
      value: briefReport,
    });
    expect(parseDocument(briefReport)).toMatchObject({ ok: true, format: "brief-report" });
  });

  it("upgrades each to phax's in-memory value, without $schema", () => {
    const { $schema: _gate, ...gate } = checkedReport;
    const { $schema: _brief, ...brief } = briefReport;
    expect(toLatestGateReport(checkedReport as never)).toEqual(gate);
    expect(toLatestBriefReport(briefReport as never)).toEqual(brief);
  });

  it("refuses each format under the other's parser", () => {
    expect(parseGateReport(briefReport).ok).toBe(false);
    expect(parseBriefReport(checkedReport).ok).toBe(false);
  });
});

type JsonObject = Readonly<Record<string, unknown>>;

function built(format: "gate-report" | "brief-report"): JsonObject {
  const entry = JSON_SCHEMA_FORMATS.find((candidate) => candidate.format === format);
  if (entry === undefined) throw new Error(`no JSON Schema entry for ${format}`);
  const { files, failures } = renderJsonSchemas([entry]);
  expect(failures).toEqual([]);
  return JSON.parse(files.get(entry.fileName) ?? "null") as JsonObject;
}

function definitions(schema: JsonObject): JsonObject {
  return schema["$defs"] as JsonObject;
}

/** The finding object of a schema: the item of its first `findings` array. */
function findingOf(schema: JsonObject): JsonObject {
  const root = ((schema["anyOf"] as ReadonlyArray<JsonObject> | undefined) ?? [schema])[0];
  const properties = root?.["properties"] as JsonObject;
  return (properties["findings"] as JsonObject)["items"] as JsonObject;
}

/** Every object schema in `value`, depth first. */
function objectSchemas(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(objectSchemas);
  if (typeof value !== "object" || value === null) return [];
  const node = value as JsonObject;
  const own = node["type"] === "object" ? [node] : [];
  return [...own, ...Object.values(node).flatMap(objectSchemas)];
}

describe("the two JSON Schemas share their definitions", () => {
  const gate = built("gate-report");
  const brief = built("brief-report");

  it.each(["ReportLocation", "ReportRelatedLocation", "ReportGuide", "LineNumber"])(
    "define %s identically",
    (name) => {
      expect(definitions(gate)[name]).toBeDefined();
      expect(definitions(brief)[name]).toEqual(definitions(gate)[name]);
    },
  );

  it("define the finding identically, apart from the brief finding's due", () => {
    const gateFinding = findingOf(gate);
    const briefFinding = findingOf(brief);
    const { due: _due, ...briefProperties } = briefFinding["properties"] as JsonObject;
    expect(briefProperties).toEqual(gateFinding["properties"]);
    expect(briefFinding["required"]).toEqual([...(gateFinding["required"] as string[]), "due"]);
  });

  it("say a line number is at least 1, as phax's parser does", () => {
    for (const schema of [gate, brief]) {
      expect(definitions(schema)["LineNumber"]).toMatchObject({ type: "integer", minimum: 1 });
    }
  });

  it("refuse unknown keys in every object", () => {
    for (const schema of [gate, brief]) {
      const objects = objectSchemas(schema);
      expect(objects.length).toBeGreaterThan(0);
      for (const object of objects) expect(object["additionalProperties"]).toBe(false);
    }
  });
});
