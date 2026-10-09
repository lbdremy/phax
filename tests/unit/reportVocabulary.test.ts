// The provider-neutral vocabulary (spec §5.45), on exactly the surfaces the
// spec names: the gate-report and brief-report JSON Schemas; the fix prompt,
// the pushed brief in both modes and the `phax brief` whole form, rendered
// from the spec's §6 examples; and the README's Gate report steps, Gate
// request and Brief provider sections. The rest of the README is not
// searched. Also holds the README side of §5.47. Every document is made up.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../../packages/schemas/build/jsonSchemas.js";
import { renderBriefSection, renderWholeBrief } from "../../src/domain/brief/render.js";
import { buildFixPrompt } from "../../src/domain/gate/fixPrompt.js";
import { decodeBriefReportFile } from "../../src/schemas/briefReport.js";
import { decodeGateReportFile } from "../../src/schemas/gateReport.js";

const readme = readFileSync(join(import.meta.dirname, "../../README.md"), "utf8");

const WORDS = [
  "guarantee",
  "leg",
  "obligation",
  "prohibition",
  "place",
  "instance",
  "blueprint",
  "skill",
  "judgement",
  "debt",
  "baseline",
];

/** Every whole-word match of a word or its plural, case-insensitively. */
function forbiddenWords(text: string): string[] {
  const pattern = new RegExp(`\\b(?:${WORDS.join("|")})s?\\b`, "gi");
  return [...text.matchAll(pattern)].map(([match]) => match);
}

/** A README `### ` section, from its heading to the next heading of level 2 or 3. */
function readmeSection(heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`README.md has no "${heading}" section`);
  const rest = readme.slice(start + heading.length + 2);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

const GUIDE = { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" };

const checkedReport = Either.getOrThrow(
  decodeGateReportFile({
    $schema: "https://docs.phax.run/schemas/gate-report/0.21.0.json",
    outcome: "checked",
    findings: [
      {
        id: "no-node-import src/greet.ts node:fs",
        rule: "a module under src/ imports no node: module",
        location: { file: "src/greet.ts", lines: [1, 1] },
        message: "imports node:fs",
        related: [{ file: "src/cli.ts", lines: [3, 5], why: "the caller, where the read belongs" }],
        guide: GUIDE,
      },
      {
        id: "exports-function src/farewell.ts",
        rule: "a module under src/ exports its function",
        location: { file: "src/farewell.ts", lines: null },
        message: "no exported function",
        related: [],
        guide: null,
      },
    ],
    review: [
      {
        owner: "hw-maintainers",
        note: "whether 'Hello, <name>!' is the greeting the product wants",
      },
    ],
  }),
);

const briefReport = Either.getOrThrow(
  decodeBriefReportFile({
    $schema: "https://docs.phax.run/schemas/brief-report/0.21.0.json",
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
      {
        id: "no-node-import src/greet.ts node:fs",
        rule: "a module under src/ imports no node: module",
        location: { file: "src/greet.ts", lines: [1, 1] },
        message: "imports node:fs",
        related: [],
        guide: GUIDE,
        due: "this-phase",
      },
      {
        id: "exports-function src/farewell.ts",
        rule: "a module under src/ exports its function",
        location: { file: "src/farewell.ts", lines: null },
        message: "no exported function",
        related: [],
        guide: null,
        due: "later",
      },
    ],
  }),
);

function fixPrompt(): string {
  if (checkedReport.outcome !== "checked") throw new Error("the fixture is a checked report");
  return buildFixPrompt({
    command: "node ./audit.mjs",
    exitCode: 1,
    attempt: 2,
    logContent: "",
    logPath: "/runs/phase-01/checks-attempt-02.log",
    reportFindings: { step: 1, findings: checkedReport.findings },
    stillFailing: new Set(["no-node-import src/greet.ts node:fs"]),
  });
}

function jsonSchema(format: string): string {
  const entry = JSON_SCHEMA_FORMATS.find((candidate) => candidate.format === format);
  if (entry === undefined) throw new Error(`no JSON Schema entry for ${format}`);
  const { files } = renderJsonSchemas([entry]);
  const file = files.get(entry.fileName);
  if (file === undefined) throw new Error(`the ${format} JSON Schema did not render`);
  return file;
}

describe("the forbidden-word search", () => {
  it("matches whole words and plurals case-insensitively, and nothing inside a word", () => {
    expect(forbiddenWords("Places, a Skill, two debts; legal, placed, displace")).toEqual([
      "Places",
      "Skill",
      "debts",
    ]);
  });
});

describe("the report vocabulary", () => {
  const surfaces: ReadonlyArray<readonly [string, () => string]> = [
    ["the gate-report JSON Schema", () => jsonSchema("gate-report")],
    ["the brief-report JSON Schema", () => jsonSchema("brief-report")],
    ["the fix prompt", fixPrompt],
    [
      "the pushed brief with findings",
      () => renderBriefSection({ kind: "answered", report: briefReport }, "findings"),
    ],
    [
      "the pushed brief with findings and rules",
      () => renderBriefSection({ kind: "answered", report: briefReport }, "findings-and-rules"),
    ],
    ["the phax brief output", () => renderWholeBrief(briefReport)],
    ["the README's Gate report steps", () => readmeSection("### Gate report steps")],
    ["the README's Gate request", () => readmeSection("### Gate request")],
    ["the README's Brief provider", () => readmeSection("### Brief provider")],
  ];

  it.each(surfaces)("%s names none of the words", (_name, render) => {
    const text = render();
    expect(text.length).toBeGreaterThan(0);
    expect(forbiddenWords(text)).toEqual([]);
  });
});

describe("the README", () => {
  it("describes the gate report under Gate report steps", () => {
    expect(readme).toContain("\n### Gate report steps\n");
    expect(readme).not.toContain("Diagnostics gate steps");
  });

  it("names neither retired format", () => {
    expect(readme).not.toContain("gate-diagnostics");
    expect(readme).not.toContain("brief-answer");
  });
});
