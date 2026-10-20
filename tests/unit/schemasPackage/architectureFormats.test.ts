import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseArchitectureReport,
  parseArchitectureRequest,
} from "../../../packages/schemas/src/index.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const SNAPSHOTS = join(__dirname, "../../../packages/schemas/snapshots");

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
      $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
      body: "# Architecture — acme-billing",
    });
    expect(parsed.ok).toBe(true);
  });

  it("refuses a third key in the report", () => {
    const parsed = parseArchitectureReport({
      $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
      body: "x",
      extra: 1,
    });
    expect(parsed.ok).toBe(false);
  });

  it.each(["architecture-request", "architecture-report"])("has a snapshot for %s", (id) => {
    expect(existsSync(join(SNAPSHOTS, id, "next.schema.json"))).toBe(true);
  });
});
