import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeArchitectureReportFile,
  decodeArchitectureRequestFile,
} from "../../../src/schemas/architecture.js";
import { readArchitectureReport } from "../../../src/schemas/persisted.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const REQUEST = schemaUrl("architecture-request", "1.2.3");
const REPORT = schemaUrl("architecture-report", "1.2.3");

describe("architecture request", () => {
  it("decodes with files null", () => {
    expect(Either.isRight(decodeArchitectureRequestFile({ $schema: REQUEST, files: null }))).toBe(
      true,
    );
  });

  it("decodes with a list of paths", () => {
    expect(
      Either.isRight(
        decodeArchitectureRequestFile({ $schema: REQUEST, files: ["src/core/billing/totals.ts"] }),
      ),
    ).toBe(true);
  });

  it.each([
    ["an empty list", { $schema: REQUEST, files: [] }],
    ["an empty path", { $schema: REQUEST, files: [""] }],
    ["a missing $schema", { files: null }],
    ["a missing files", { $schema: REQUEST }],
    ["a $schema naming another format", { $schema: REPORT, files: null }],
    ["an extra key", { $schema: REQUEST, files: null, phase: "phase-01" }],
  ])("refuses %s", (_name, input) => {
    expect(Either.isLeft(decodeArchitectureRequestFile(input))).toBe(true);
  });
});

describe("architecture report", () => {
  it("decodes { $schema, body }", () => {
    expect(
      Either.isRight(
        decodeArchitectureReportFile({ $schema: REPORT, body: "# Architecture — acme-billing" }),
      ),
    ).toBe(true);
  });

  it.each([
    ["an extra key", { $schema: REPORT, body: "x", findings: [] }],
    ["an empty body", { $schema: REPORT, body: "" }],
    ["a missing $schema", { body: "x" }],
    ["a missing body", { $schema: REPORT }],
  ])("refuses %s", (_name, input) => {
    expect(Either.isLeft(decodeArchitectureReportFile(input))).toBe(true);
  });
});

describe("readArchitectureReport", () => {
  it("names the architecture-report URL it reads when $schema is missing", () => {
    const read = readArchitectureReport({ body: "x" });
    expect(Either.isLeft(read)).toBe(true);
    if (Either.isLeft(read)) {
      expect(read.left.reads).toMatch(/architecture-report\/\d+\.\d+\.\d+\.json$/);
    }
  });

  it("refuses a report in another format", () => {
    expect(Either.isLeft(readArchitectureReport({ $schema: REQUEST, body: "x" }))).toBe(true);
  });
});
