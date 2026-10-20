import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeArchitectureReportFile,
  decodeArchitectureRequestFile,
} from "../../../src/schemas/architecture.js";
import { describeReportError, readArchitectureReport } from "../../../src/schemas/persisted.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
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

const PART = {
  id: "core-decide",
  name: "core · decide",
  description: "The pure decision logic.",
  globs: ["src/core/decide/**"],
};

function report(parts: unknown) {
  return { $schema: REPORT, body: "# Architecture — acme-billing", parts };
}

const OMITTED_KEYS = ["id", "name", "description", "globs"] as const;
const BAD_IDS = ["Core_Decide", "core--decide", "-core", "core-", ""];
const BAD_GLOBS = [
  "/src/**",
  "src\\core",
  "{docs,src}/**",
  "src//x",
  "src/",
  "./src/**",
  "src/../x",
  "src/**.ts",
  "a**",
  "**b",
  "",
];

describe("architecture report", () => {
  it("decodes { $schema, body, parts: [] }", () => {
    expect(Either.isRight(decodeArchitectureReportFile(report([])))).toBe(true);
  });

  it("decodes a report with three parts", () => {
    const parts = [
      PART,
      {
        id: "http-requests",
        name: "http · requests",
        description: "Request handlers.",
        globs: ["src/http/**", "src/*/schemas/**"],
      },
      { id: "docs", name: "docs", description: "The docs.", globs: ["docs/**", "*.md"] },
    ];
    expect(Either.isRight(decodeArchitectureReportFile(report(parts)))).toBe(true);
  });

  const refused: ReadonlyArray<readonly [string, unknown]> = [
    ["an extra key", { ...report([]), findings: [] }],
    ["an empty body", { ...report([]), body: "" }],
    ["a missing $schema", { body: "x", parts: [] }],
    ["a missing body", { $schema: REPORT, parts: [] }],
    ["a missing parts", { $schema: REPORT, body: "x" }],
    ["a repeated part id", report([PART, { ...PART, name: "other" }])],
    ["a part with model", report([{ ...PART, model: "claude-sonnet-5-5" }])],
    ["an empty globs", report([{ ...PART, globs: [] }])],
    ...OMITTED_KEYS.map((key) => {
      const rest: Record<string, unknown> = { ...PART };
      delete rest[key];
      return [`a part missing ${key}`, report([rest])] as const;
    }),
    ...BAD_IDS.map((id) => [`the id ${JSON.stringify(id)}`, report([{ ...PART, id }])] as const),
    ...BAD_GLOBS.map(
      (glob) => [`the glob ${JSON.stringify(glob)}`, report([{ ...PART, globs: [glob] }])] as const,
    ),
  ];

  it.each(refused)("refuses %s", (_name, input) => {
    expect(Either.isLeft(decodeArchitectureReportFile(input))).toBe(true);
  });

  it("names the repeated id", () => {
    const decoded = decodeArchitectureReportFile(report([PART, PART]));
    expect(Either.isLeft(decoded) && String(decoded.left)).toContain(
      'part id "core-decide" is used twice',
    );
  });

  it.each(["*.md", "docs/**", "src/*/schemas/**", "src/[id].tsx", ".env", "a?/b"])(
    "accepts the glob %s",
    (glob) => {
      expect(
        Either.isRight(decodeArchitectureReportFile(report([{ ...PART, globs: [glob] }]))),
      ).toBe(true);
    },
  );
});

describe("readArchitectureReport", () => {
  it("names the architecture-report URL it reads when $schema is missing", () => {
    const read = readArchitectureReport({ body: "x", parts: [] });
    expect(Either.isLeft(read)).toBe(true);
    if (Either.isLeft(read)) {
      expect(read.left.reads).toMatch(/architecture-report\/\d+\.\d+\.\d+\.json$/);
    }
  });

  it("refuses a body-only report, naming parts", () => {
    const read = readArchitectureReport({
      $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
      body: "x",
    });
    expect(Either.isLeft(read)).toBe(true);
    if (Either.isLeft(read)) expect(describeReportError(read.left)).toContain("parts");
  });

  it("refuses a report in another format", () => {
    expect(Either.isLeft(readArchitectureReport({ $schema: REQUEST, body: "x", parts: [] }))).toBe(
      true,
    );
  });
});
