// The gate report at decode level: the §6 checked and refused examples, and
// the malformed cases of spec guarantee-reports §8, each refused with the id,
// the file or the key path it names. Every document is made up.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeGateReportFile } from "../../../src/schemas/gateReport.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import { describeReportIssue } from "../../../src/schemas/report.js";

type Doc = Record<string, unknown>;

function greetFinding(): Doc {
  return {
    id: "no-node-import src/greet.ts node:fs",
    rule: "a module under src/ imports no node: module",
    location: { file: "src/greet.ts", lines: [1, 1] },
    message: "imports node:fs",
    related: [{ file: "src/cli.ts", lines: [3, 5], why: "the caller, where the read belongs" }],
    guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
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
  };
}

/** The §6 checked example. */
function checked(): Doc {
  return {
    $schema: currentSchemaUrl("gate-report"),
    outcome: "checked",
    findings: [greetFinding(), farewellFinding()],
    review: [
      {
        owner: "hw-maintainers",
        note: "whether 'Hello, <name>!' is the greeting the product wants",
      },
    ],
  };
}

/** The §6 refused example. */
function refused(): Doc {
  return {
    $schema: currentSchemaUrl("gate-report"),
    outcome: "refused",
    reason: "the checks need hw-rules 2, and 1 is installed",
    remedy: "pnpm add -D hw-rules@2",
  };
}

/** `checked()` with its first finding replaced by `first`. */
function withFirstFinding(first: Doc): Doc {
  return { ...checked(), findings: [first, farewellFinding()] };
}

/** The one line a refused document gives. */
function issue(input: unknown): string {
  const decoded = decodeGateReportFile(input);
  if (Either.isRight(decoded)) throw new Error(`expected a refusal, got ${JSON.stringify(input)}`);
  return describeReportIssue(decoded.left);
}

describe("gate report: the two outcomes", () => {
  it("decodes the §6 checked example as written", () => {
    expect(decodeGateReportFile(checked())).toEqual(Either.right(checked()));
  });

  it("decodes the §6 refused example as written", () => {
    expect(decodeGateReportFile(refused())).toEqual(Either.right(refused()));
  });

  it("decodes a passing report: empty findings and review", () => {
    const passing = { ...checked(), findings: [], review: [] };
    expect(decodeGateReportFile(passing)).toEqual(Either.right(passing));
  });

  it("decodes null lines, null guide and empty related", () => {
    const decoded = decodeGateReportFile({ ...checked(), findings: [farewellFinding()] });
    expect(Either.isRight(decoded)).toBe(true);
  });
});

describe("gate report: duplicate ids and disordered lines are malformed", () => {
  it("names the id two findings share", () => {
    const shared = { ...farewellFinding(), id: "no-node-import src/greet.ts node:fs" };
    expect(issue({ ...checked(), findings: [greetFinding(), shared] })).toBe(
      'findings: finding id "no-node-import src/greet.ts node:fs" is used twice',
    );
  });

  it("names the file of a location whose lines end before they start", () => {
    const line = issue(
      withFirstFinding({ ...greetFinding(), location: { file: "src/greet.ts", lines: [3, 1] } }),
    );
    expect(line).toBe("findings[0].location: lines [3, 1] of src/greet.ts are out of order");
  });

  it("names the file of a related entry whose lines start below line 1", () => {
    const line = issue(
      withFirstFinding({
        ...greetFinding(),
        related: [{ file: "src/cli.ts", lines: [0, 2], why: "the caller" }],
      }),
    );
    expect(line).toBe("findings[0].related[0]: lines [0, 2] of src/cli.ts start below line 1");
  });

  it("accepts a one-line pair", () => {
    const decoded = decodeGateReportFile(
      withFirstFinding({ ...greetFinding(), location: { file: "src/greet.ts", lines: [4, 4] } }),
    );
    expect(Either.isRight(decoded)).toBe(true);
  });
});

describe("gate report: keys outside the format are refused", () => {
  it.each([
    [
      "a finding's due",
      withFirstFinding({ ...greetFinding(), due: "this-phase" }),
      "findings[0].due",
    ],
    ["a top-level debt", { ...checked(), debt: [] }, "debt"],
    [
      "a guide's kind",
      withFirstFinding({
        ...greetFinding(),
        guide: { summary: "keep I/O in the module's caller", read: "guides/x.md", kind: "skill" },
      }),
      "findings[0].guide.kind",
    ],
    ["a refused report's findings", { ...refused(), findings: [] }, "findings"],
  ])("refuses %s, naming its path", (_name, input, path) => {
    expect(issue(input)).toMatch(
      new RegExp(`^${path.replaceAll(/[.[\]]/g, "\\$&")}: is unexpected`),
    );
  });

  it.each([
    ["a checked report without review", { ...checked(), review: undefined }, "review"],
    ["a refused report without remedy", { ...refused(), remedy: undefined }, "remedy"],
  ])("refuses %s, naming the missing key", (_name, input, key) => {
    const { [key]: _dropped, ...rest } = input as Doc;
    expect(issue(rest)).toBe(`${key}: is missing`);
  });
});

describe("gate report: exactly two outcomes", () => {
  it("refuses an outcome that is neither checked nor refused", () => {
    expect(issue({ ...checked(), outcome: "skipped" })).toBe(
      'outcome: Expected "checked" | "refused", actual "skipped"',
    );
  });

  it("refuses a report without outcome", () => {
    const { outcome: _outcome, ...rest } = checked();
    expect(issue(rest)).toBe("outcome: is missing");
  });
});
