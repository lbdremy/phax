import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import {
  parseArchitectureReport,
  parseArchitectureRequest,
} from "../../../packages/schemas/src/index.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const SNAPSHOTS = join(__dirname, "../../../packages/schemas/snapshots");

const REPORT_SCHEMA = schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]);

const PARTS = [
  {
    id: "core-decide",
    name: "core · decide",
    description: "The pure decision logic.",
    globs: ["src/core/decide/**"],
  },
];

describe("architecture formats in the schemas package", () => {
  it("parses a valid architecture request", () => {
    const parsed = parseArchitectureRequest({
      $schema: schemaUrl("architecture-request", CURRENT_STAMPS["architecture-request"]),
      files: ["src/core/billing/totals.ts"],
    });
    expect(parsed.ok).toBe(true);
  });

  it("parses a valid architecture report", () => {
    const parsed = parseArchitectureReport({
      $schema: REPORT_SCHEMA,
      body: "# Architecture — acme-billing",
      parts: PARTS,
    });
    expect(parsed.ok).toBe(true);
  });

  it("refuses a fourth key in the report", () => {
    const parsed = parseArchitectureReport({
      $schema: REPORT_SCHEMA,
      body: "x",
      parts: [],
      extra: 1,
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuses a report without parts", () => {
    const parsed = parseArchitectureReport({ $schema: REPORT_SCHEMA, body: "x" });
    expect(parsed.ok).toBe(false);
  });

  it("The report schema requires parts", () => {
    const shape = CURRENT_SHAPES["architecture-report"];
    const schema = JSON.parse(
      readFileSync(join(SNAPSHOTS, "architecture-report", `${shape}.schema.json`), "utf8"),
    ) as {
      required: string[];
      additionalProperties: boolean;
      properties: { parts: { items: { required: string[]; additionalProperties: boolean } } };
    };
    expect(schema.required).toEqual(["$schema", "body", "parts"]);
    expect(schema.additionalProperties).toBe(false);
    const part = schema.properties.parts.items;
    expect(part.required).toEqual(["id", "name", "description", "globs"]);
    expect(part.additionalProperties).toBe(false);
  });

  // `next` while the release is open, `<X.Y.Z>` once it is cut: either holds.
  it.each(["architecture-request", "architecture-report"])("has a snapshot for %s", (id) => {
    const snapshots = existsSync(join(SNAPSHOTS, id)) ? readdirSync(join(SNAPSHOTS, id)) : [];
    expect(snapshots.some((name) => /^(next|\d+\.\d+\.\d+)\.schema\.json$/.test(name))).toBe(true);
  });
});
