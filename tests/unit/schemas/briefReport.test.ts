// The brief report at decode level: the §6 example, and the malformed cases
// of spec guarantee-reports §8, each refused with the id, the file or the key
// path it names. A brief report has no outcome. Every document is made up.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeBriefReportFile } from "../../../src/schemas/briefReport.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import { describeReportIssue } from "../../../src/schemas/report.js";

type Doc = Record<string, unknown>;

const GUIDE = { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" };

function greetFinding(): Doc {
  return {
    id: "no-node-import src/greet.ts node:fs",
    rule: "a module under src/ imports no node: module",
    location: { file: "src/greet.ts", lines: [1, 1] },
    message: "imports node:fs",
    related: [],
    guide: GUIDE,
    due: "this-phase",
  };
}

function farewellFinding(): Doc {
  return {
    id: "exports-function src/farewell.ts",
    rule: "a module under src/ exports its function",
    location: { file: "src/farewell.ts", lines: null },
    message: "no exported function",
    related: [],
    guide: null,
    due: "later",
  };
}

/** The §6 brief example. */
function report(): Doc {
  return {
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
    findings: [greetFinding(), farewellFinding()],
  };
}

/** The one line a refused document gives. */
function issue(input: unknown): string {
  const decoded = decodeBriefReportFile(input);
  if (Either.isRight(decoded)) throw new Error(`expected a refusal, got ${JSON.stringify(input)}`);
  return describeReportIssue(decoded.left);
}

describe("brief report: what it carries", () => {
  it("decodes the §6 example as written", () => {
    expect(decodeBriefReportFile(report())).toEqual(Either.right(report()));
  });

  it("decodes a report with nothing to report", () => {
    const empty = { $schema: currentSchemaUrl("brief-report"), rules: [], findings: [] };
    expect(decodeBriefReportFile(empty)).toEqual(Either.right(empty));
  });

  it("decodes a null due, for a request without phase facts", () => {
    const decoded = decodeBriefReportFile({
      ...report(),
      findings: [{ ...greetFinding(), due: null }],
    });
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("refuses a due outside this-phase, later and null", () => {
    expect(issue({ ...report(), findings: [{ ...greetFinding(), due: "soon" }] })).toMatch(
      /^findings\[0\]\.due: /,
    );
  });

  it("refuses a finding without due", () => {
    const { due: _due, ...withoutDue } = greetFinding();
    expect(issue({ ...report(), findings: [withoutDue] })).toBe("findings[0].due: is missing");
  });

  it("refuses a rule with no file", () => {
    const [first] = report()["rules"] as ReadonlyArray<Doc>;
    expect(issue({ ...report(), rules: [{ ...first, files: [] }] })).toMatch(/^rules\[0\]\.files/);
  });
});

describe("brief report: malformed reports name what is wrong", () => {
  it("names the id two findings share", () => {
    const shared = { ...farewellFinding(), id: "no-node-import src/greet.ts node:fs" };
    expect(issue({ ...report(), findings: [greetFinding(), shared] })).toBe(
      'findings: finding id "no-node-import src/greet.ts node:fs" is used twice',
    );
  });

  it("names the file of a disordered lines pair", () => {
    const finding = { ...greetFinding(), location: { file: "src/greet.ts", lines: [3, 1] } };
    expect(issue({ ...report(), findings: [finding] })).toBe(
      "findings[0].location: lines [3, 1] of src/greet.ts are out of order",
    );
  });

  it("refuses a top-level review, naming it", () => {
    expect(issue({ ...report(), review: [] })).toMatch(/^review: is unexpected/);
  });

  it("refuses an outcome: a brief report has none", () => {
    expect(issue({ ...report(), outcome: "checked" })).toMatch(/^outcome: is unexpected/);
  });

  it("refuses a key inside a rule's guide, naming its path", () => {
    const [first, second] = report()["rules"] as ReadonlyArray<Doc>;
    const rules = [first, { ...second, guide: { ...GUIDE, kind: "skill" } }];
    expect(issue({ ...report(), rules })).toMatch(/^rules\[1\]\.guide\.kind: is unexpected/);
  });
});
