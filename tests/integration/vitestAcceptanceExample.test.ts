import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Either } from "effect";
import { parseGateReport } from "../../packages/schemas/src/index.js";
import { serializeAcceptanceRequest } from "../../src/app/gates.js";
import { makeAcceptanceRequest } from "../../src/domain/gate/acceptanceRequest.js";
import { decodePhaxConfig } from "../../src/schemas/phaxConfig.js";
import {
  currentSchemaUrl,
  describeReportError,
  readGateReport,
} from "../../src/schemas/persisted.js";
import type { GateReport } from "../../src/schemas/gateReport.js";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const mainScript = join(repoRoot, "examples/vitest-acceptance/main.mjs");

const PRUNE = "tests/prune.test.ts";
const REFUNDS = "tests/refunds.test.ts";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function lines(...text: readonly string[]): string {
  return text.join("\n") + "\n";
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

/** A fresh temporary git repository, an acme-billing-like one. */
function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "phax-vitest-acceptance-"));
  tempDirs.push(cwd);
  git(cwd, ["init", "-q"]);
  return cwd;
}

/** Write (or, with null, delete) files in the working tree. */
function edit(cwd: string, files: Readonly<Record<string, string | null>>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path);
    if (content === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

/** Commit the given files and return the commit's full object name. */
function commit(cwd: string, files: Readonly<Record<string, string | null>>): string {
  edit(cwd, files);
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "--allow-empty", "-m", "commit"]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function run(
  cwd: string,
  stdin: string,
): { stdout: string; stderr: string; status: number | null } {
  const { stdout, stderr, status } = spawnSync(process.execPath, [mainScript], {
    input: stdin,
    cwd,
    encoding: "utf8",
  });
  return { stdout, stderr, status };
}

// Read as phax reads an acceptance provider's answer, and as a consumer reads it
// through the schemas package.
function answerOf(stdout: string): GateReport {
  expect(stdout.endsWith("\n")).toBe(true);
  expect(stdout.trimEnd().includes("\n")).toBe(false);
  const printed: unknown = JSON.parse(stdout);
  expect(parseGateReport(printed).ok).toBe(true);
  expect((printed as { $schema: string }).$schema).toBe(currentSchemaUrl("gate-report"));
  const result = readGateReport(printed);
  if (Either.isLeft(result)) throw new Error(describeReportError(result.left));
  return result.right;
}

function checkedFindings(report: GateReport) {
  if (report.outcome !== "checked") throw new Error(`expected a checked report: ${report.reason}`);
  return report.findings;
}

// Every request is written by phax's own serializer, so the example is held to what phax sends.
function authoredRequest(base: string, files: readonly string[]): string {
  return serializeAcceptanceRequest(
    makeAcceptanceRequest({
      role: {
        role: "acceptance",
        pair: { acceptancePhase: "phase-01", passingPhase: "phase-02", files },
      },
      phaseId: "phase-01",
      base,
      acceptanceCommit: null,
    }),
  );
}

function authored(cwd: string, base: string, files: readonly [string, ...string[]]) {
  const { stdout, status } = run(cwd, authoredRequest(base, files));
  return { report: answerOf(stdout), status, stdout };
}

function passed(
  cwd: string,
  base: string,
  acceptanceCommit: string,
  files: readonly [string, ...string[]],
) {
  const request = serializeAcceptanceRequest(
    makeAcceptanceRequest({
      role: {
        role: "passing",
        pair: { acceptancePhase: "phase-01", passingPhase: "phase-02", files },
      },
      phaseId: "phase-02",
      base,
      acceptanceCommit,
    }),
  );
  const { stdout, status } = run(cwd, request);
  return { report: answerOf(stdout), status, stdout };
}

const PRUNE_BASE = lines(
  'import { expect, it } from "vitest";',
  'import { prune } from "../src/prune";',
  "",
  'it("keeps the newest run", () => {',
  "  expect(prune([1, 2])).toEqual([2]);",
  "});",
  "",
  'it("drops archived runs", () => {',
  "  expect(prune([3])).toEqual([]);",
  "});",
);

describe("examples/vitest-acceptance, authored verdict", () => {
  it("asks a marker of every added or modified test, and of no deleted or unchanged one", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    edit(cwd, {
      [PRUNE]: lines(
        'import { expect, it, test } from "vitest";',
        'import { prune } from "../src/prune";',
        "",
        'it("keeps the newest run", () => {',
        "  expect(prune([1, 2, 3])).toEqual([3]);",
        "});",
        "",
        "test.fails('refunds a partial capture', () => {",
        "  expect(refund(100, 40)).toBe(40);",
        "});",
        "",
        'it("caps a refund at the invoice total", () => {',
        "  expect(refund(100, 140)).toBe(100);",
        "});",
      ),
    });
    const { report, status } = authored(cwd, base, [PRUNE]);
    const findings = checkedFindings(report);
    expect(findings.map((f) => f.id)).toEqual([
      `acceptance-unmarked:${PRUNE}:keeps the newest run`,
      `acceptance-unmarked:${PRUNE}:caps a refund at the invoice total`,
    ]);
    expect(findings[0]).toEqual({
      id: `acceptance-unmarked:${PRUNE}:keeps the newest run`,
      rule: expect.stringContaining("expected-failure marker"),
      location: { file: PRUNE, lines: [4, 6] },
      message: expect.stringContaining("keeps the newest run"),
      related: [],
      guide: null,
    });
    expect(findings[1]?.location).toEqual({ file: PRUNE, lines: [12, 14] });
    expect(status).toBe(1);
  });

  it("passes a new file whose every test is marked", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    edit(cwd, {
      [REFUNDS]: lines(
        'import { expect, it, test } from "vitest";',
        "test.fails('refunds a partial capture', () => {",
        "  expect(refund(100, 40)).toBe(40);",
        "});",
        "it.fails('caps a refund at the invoice total', () => {",
        "  expect(refund(100, 140)).toBe(100);",
        "});",
        "test.concurrent.fails('refunds twice', () => {});",
      ),
    });
    const { report, status } = authored(cwd, base, [PRUNE, REFUNDS]);
    expect(report).toMatchObject({ outcome: "checked", findings: [], review: [] });
    expect(status).toBe(0);
  });

  it("judges a file absent now as having no test and no finding", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    const { report, status } = authored(cwd, base, [REFUNDS]);
    expect(checkedFindings(report)).toEqual([]);
    expect(status).toBe(0);
  });

  it("identifies a test by its enclosing blocks and its title, a table row included", () => {
    const cwd = makeRepo();
    const body = (rows: string, marker: string, other: string) =>
      lines(
        'import { describe, test, it } from "vitest";',
        'describe("outer", () => {',
        '  describe("inner", () => {',
        `    test${marker}.each(${rows})(\`charges %i\`, (n, cents) => {`,
        "      expect(charge(n)).toBe(cents);",
        "    });",
        "  });",
        "});",
        'describe("other", () => {',
        '  describe("inner", () => {',
        `    it${other}(\`charges %i\`, () => {});`,
        "  });",
        "});",
      );
    const base = commit(cwd, { [REFUNDS]: body("[[1, 100]]", ".fails", ".fails") });
    edit(cwd, { [REFUNDS]: body("[[1, 100], [2, 250]]", "", ".fails") });
    const { report, status } = authored(cwd, base, [REFUNDS]);
    expect(checkedFindings(report).map((f) => f.id)).toEqual([
      `acceptance-unmarked:${REFUNDS}:outer > inner > charges %i`,
    ]);
    expect(status).toBe(1);
  });

  it("numbers tests that share an identity and names a computed title by its tree", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [REFUNDS]: "// nothing yet\n" });
    edit(cwd, {
      [REFUNDS]: lines(
        "it('refunds', () => {});",
        "it('refunds', () => {});",
        "it(TITLE, () => {});",
      ),
    });
    const ids = checkedFindings(authored(cwd, base, [REFUNDS]).report).map((f) => f.id);
    expect(ids).toHaveLength(3);
    expect(ids.slice(0, 2)).toEqual([
      `acceptance-unmarked:${REFUNDS}:refunds`,
      `acceptance-unmarked:${REFUNDS}:refunds #2`,
    ]);
    expect(ids[2]).toContain('"name":"TITLE"');
  });

  it("treats a `.fails` outside a test's callee chain as ordinary code", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [REFUNDS]: "// nothing yet\n" });
    edit(cwd, {
      [REFUNDS]: lines("it('refunds', () => {", "  expect(result.fails).toBe(0);", "});"),
    });
    expect(checkedFindings(authored(cwd, base, [REFUNDS]).report)).toHaveLength(1);
  });

  it("is blind to re-indentation and comments inside an unchanged test", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    edit(cwd, {
      [PRUNE]: lines(
        'import { expect, it } from "vitest";',
        'import { prune } from "../src/prune";',
        "",
        "// the newest run survives",
        'it("keeps the newest run", () => {',
        "    // one run in, one run out",
        "    expect(prune([1, 2])).toEqual([2]);",
        "});",
        "",
        'it("drops archived runs", () => {',
        "  expect(prune([3])).toEqual([]);",
        "});",
      ),
    });
    const { report, status } = authored(cwd, base, [PRUNE]);
    expect(checkedFindings(report)).toEqual([]);
    expect(status).toBe(0);
  });

  it.each([
    ["test.fails.skip('refunds', () => {});", "carries .skip"],
    ["test.skip.fails('refunds', () => {});", "carries .skip"],
    ["test.fails.todo('refunds');", "carries .todo"],
    ["test.fails('refunds');", "has no test function"],
    ["test.fails.skipIf(true)('refunds', () => {});", "carries .skipIf"],
    ["test.fails.only('refunds', () => {});", "carries .only"],
    ["describe.skip('refund', () => { test.fails('refunds', () => {}); });", 'block "refund"'],
  ])("finds a marked test that never runs: %s", (code, reason) => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    edit(cwd, { [REFUNDS]: code });
    const { report, status } = authored(cwd, base, [REFUNDS]);
    const findings = checkedFindings(report);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toMatch(new RegExp(`^acceptance-not-run:${REFUNDS}:`));
    expect(findings[0]?.message).toContain(reason);
    expect(status).toBe(1);
  });

  it("leaves a test that never runs alone when it is unchanged since the base", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [REFUNDS]: "test.skip('voids a refund', () => {});\n" });
    edit(cwd, {
      [REFUNDS]: lines(
        "test.skip('voids a refund', () => {});",
        "test.fails('refunds', () => {});",
      ),
    });
    expect(checkedFindings(authored(cwd, base, [REFUNDS]).report)).toEqual([]);
  });

  it("judges a file declared twice once", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    edit(cwd, { [REFUNDS]: "test('refunds', () => {});\n" });
    const ids = checkedFindings(authored(cwd, base, [REFUNDS, REFUNDS]).report).map((f) => f.id);
    expect(ids).toEqual([`acceptance-unmarked:${REFUNDS}:refunds`]);
  });

  it("reports an unparsable acceptance test file as a finding, not a refusal", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    edit(cwd, { [PRUNE]: lines("it.fails('keeps the newest run', () => {", "  expect(") });
    const { report, status } = authored(cwd, base, [PRUNE]);
    const findings = checkedFindings(report);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: `acceptance-unparsable:${PRUNE}`,
      location: { file: PRUNE },
    });
    expect(status).toBe(1);
  });
});

const REFUNDS_ACCEPTANCE = lines(
  "import { expect, test } from 'vitest'",
  "import { refund } from '../src/refund'",
  "",
  "test.fails('refunds a partial capture', () => {",
  "  expect(refund(100, 40)).toBe(40)",
  "})",
  "",
  "test.fails('caps a refund at the invoice total', () => {",
  "  expect(refund(100, 140)).toBe(120)",
  "})",
);

/** The acceptance test with every `test.fails` marker removed. */
function stripBoth(text: string): string {
  return text.replaceAll("test.fails(", "test(");
}

function passingRepo() {
  const cwd = makeRepo();
  const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
  const acceptanceCommit = commit(cwd, { [REFUNDS]: REFUNDS_ACCEPTANCE });
  return { cwd, base, acceptanceCommit };
}

/** A one-test acceptance test expecting `value`. */
function acceptanceTest(value: string): string {
  return `test.fails('refunds', () => { expect(f()).toBe(${value}); });\n`;
}

describe("examples/vitest-acceptance, passed verdict", () => {
  it("passes when both markers are removed and the file is only reformatted", () => {
    const { cwd, base, acceptanceCommit } = passingRepo();
    edit(cwd, {
      [REFUNDS]: lines(
        'import { expect, test } from "vitest";',
        'import { refund } from "../src/refund";',
        "",
        'test("refunds a partial capture", () => {',
        "    expect(",
        "      refund(100, 40),",
        "    ).toBe(40);",
        "});",
        "",
        "// the cap",
        'test("caps a refund at the invoice total", () => {',
        "  expect(refund(100, 140)).toBe(120);",
        "});",
      ),
    });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS]);
    expect(report).toMatchObject({ outcome: "checked", findings: [], review: [] });
    expect(status).toBe(0);
  });

  it("names the one marker still left", () => {
    const { cwd, base, acceptanceCommit } = passingRepo();
    edit(cwd, { [REFUNDS]: REFUNDS_ACCEPTANCE.replace("test.fails('refunds", "test('refunds") });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS]);
    const findings = checkedFindings(report);
    expect(findings.map((f) => f.id)).toEqual([
      `acceptance-marker-left:${REFUNDS}:caps a refund at the invoice total`,
    ]);
    expect(findings[0]?.location).toEqual({ file: REFUNDS, lines: [8, 10] });
    expect(status).toBe(1);
  });

  it.each([
    {
      change: "an assertion edited",
      working: stripBoth(REFUNDS_ACCEPTANCE).replace("toBe(120)", "toBe(100)"),
      names: "caps a refund at the invoice total",
    },
    {
      change: "a test deleted",
      working: stripBoth(
        REFUNDS_ACCEPTANCE.slice(0, REFUNDS_ACCEPTANCE.indexOf("test.fails('caps")),
      ),
      names: "caps a refund at the invoice total",
    },
    {
      change: "a test added",
      working: stripBoth(REFUNDS_ACCEPTANCE) + "\ntest('refunds twice', () => {})\n",
      names: "refunds twice",
    },
    {
      change: "a marker swapped for a skip",
      working: stripBoth(REFUNDS_ACCEPTANCE).replace("test('caps", "test.skip('caps"),
      names: "caps a refund at the invoice total",
    },
    {
      change: "an import edited",
      working: stripBoth(REFUNDS_ACCEPTANCE).replace("'../src/refund'", "'../src/refunds'"),
      names: "outside any test",
    },
  ])("finds the file changed when $change", ({ working, names }) => {
    const { cwd, base, acceptanceCommit } = passingRepo();
    edit(cwd, { [REFUNDS]: working });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS]);
    const findings = checkedFindings(report);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: `acceptance-changed:${REFUNDS}`,
      location: { file: REFUNDS },
      message: expect.stringContaining(names),
    });
    expect(status).toBe(1);
  });

  it.each([
    ["a tagged template's raw text", "String.raw`a\\nb`", "String.raw`a\nb`"],
    ["a number beyond JavaScript's range", "1e999", "null"],
  ])("finds the file changed when %s changes", (_what, before, after) => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    const acceptanceCommit = commit(cwd, { [REFUNDS]: acceptanceTest(before) });
    edit(cwd, { [REFUNDS]: acceptanceTest(after).replace("test.fails(", "test(") });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS]);
    expect(checkedFindings(report).map((f) => f.id)).toEqual([`acceptance-changed:${REFUNDS}`]);
    expect(status).toBe(1);
  });

  it("finds the file changed when the acceptance test file is deleted", () => {
    const { cwd, base, acceptanceCommit } = passingRepo();
    edit(cwd, { [REFUNDS]: null });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS]);
    expect(checkedFindings(report)).toMatchObject([
      { id: `acceptance-changed:${REFUNDS}`, location: { file: REFUNDS } },
    ]);
    expect(status).toBe(1);
  });

  it("finds a file that the acceptance commit lacks and the working tree has changed", () => {
    const { cwd, base, acceptanceCommit } = passingRepo();
    edit(cwd, {
      [REFUNDS]: REFUNDS_ACCEPTANCE.replaceAll("test.fails(", "test("),
      "tests/extra.test.ts": "it('x', () => {});\n",
    });
    const { report } = passed(cwd, base, acceptanceCommit, [REFUNDS, "tests/extra.test.ts"]);
    expect(checkedFindings(report).map((f) => f.id)).toEqual([
      `acceptance-changed:tests/extra.test.ts`,
    ]);
  });

  it("finds nothing for a file absent at the acceptance commit and in the working tree", () => {
    const { cwd, base, acceptanceCommit } = passingRepo();
    edit(cwd, { [REFUNDS]: REFUNDS_ACCEPTANCE.replaceAll("test.fails(", "test(") });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS, "tests/none.test.ts"]);
    expect(checkedFindings(report)).toEqual([]);
    expect(status).toBe(0);
  });

  it("reports an unparsable working-tree file as a finding", () => {
    const { cwd, base, acceptanceCommit } = passingRepo();
    edit(cwd, { [REFUNDS]: "test('x', () => {\n" });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS]);
    expect(checkedFindings(report).map((f) => f.id)).toEqual([`acceptance-unparsable:${REFUNDS}`]);
    expect(status).toBe(1);
  });

  it("refuses an acceptance test file that does not parse at the acceptance commit, naming the recovery", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    const acceptanceCommit = commit(cwd, { [REFUNDS]: "test.fails('x', () => {\n" });
    edit(cwd, { [REFUNDS]: REFUNDS_ACCEPTANCE });
    const { report, status } = passed(cwd, base, acceptanceCommit, [REFUNDS]);
    expect(report).toMatchObject({
      outcome: "refused",
      reason: expect.stringContaining(REFUNDS),
      remedy: expect.stringContaining("--skip-acceptance"),
    });
    expect(status).toBe(1);
  });
});

describe("examples/vitest-acceptance, requests it cannot read", () => {
  const sha = "a".repeat(40);
  const valid = {
    $schema: currentSchemaUrl("acceptance-request"),
    verdict: "authored",
    phase: "phase-01",
    acceptancePhase: "phase-01",
    base: sha,
    files: ["tests/refunds.test.ts"],
  };
  const without = (key: string) =>
    Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));

  it.each([
    { name: "no $schema", stdin: JSON.stringify(without("$schema")), reason: "$schema" },
    {
      name: "another format's $schema",
      stdin: JSON.stringify({
        ...valid,
        $schema: "https://docs.phax.run/schemas/gate-request/0.20.0.json",
      }),
      reason: "$schema",
    },
    {
      name: "an oracle-request 0.26.0 document",
      stdin: JSON.stringify({
        ...valid,
        $schema: "https://docs.phax.run/schemas/oracle-request/0.26.0.json",
        oraclePhase: "phase-01",
      }),
      reason: "$schema",
    },
    {
      name: "a verdict other than authored or passed",
      stdin: JSON.stringify({ ...valid, verdict: "discharged" }),
      reason: "verdict",
    },
    { name: "stdin that is not JSON", stdin: "this is not json", reason: "JSON" },
    { name: "an empty stdin", stdin: "", reason: "JSON" },
    {
      name: "a key the variant does not have",
      stdin: JSON.stringify({ ...valid, acceptanceCommit: sha }),
      reason: "acceptanceCommit",
    },
    { name: "a key the variant lacks", stdin: JSON.stringify(without("base")), reason: "base" },
    {
      name: "a malformed phase id",
      stdin: JSON.stringify({ ...valid, phase: "phase-1" }),
      reason: "phase",
    },
    {
      name: "a malformed commit",
      stdin: JSON.stringify({ ...valid, base: "abc123" }),
      reason: "base",
    },
    {
      name: "an absolute file path",
      stdin: JSON.stringify({ ...valid, files: ["/etc/passwd.ts"] }),
      reason: "/etc/passwd.ts",
    },
    {
      name: "a file path with a .. segment",
      stdin: JSON.stringify({ ...valid, files: ["tests/../../x.ts"] }),
      reason: "tests/../../x.ts",
    },
    {
      name: "a file that is not a script",
      stdin: JSON.stringify({ ...valid, files: ["tests/refunds.md"] }),
      reason: "tests/refunds.md",
    },
    { name: "no file", stdin: JSON.stringify({ ...valid, files: [] }), reason: "files" },
    {
      name: "a base that is not a commit of the repository",
      stdin: JSON.stringify(valid),
      reason: sha,
    },
  ])("refuses $name with a reason and a remedy", ({ stdin, reason }) => {
    const cwd = makeRepo();
    commit(cwd, { [PRUNE]: PRUNE_BASE });
    const { stdout, status } = run(cwd, stdin);
    const report = answerOf(stdout);
    if (report.outcome !== "refused") throw new Error("expected a refused report");
    expect(report.reason).toContain(reason);
    expect(report.reason.includes("\n")).toBe(false);
    expect(report.remedy.length).toBeGreaterThan(0);
    expect(report.remedy.includes("\n")).toBe(false);
    expect(status).toBe(1);
  });

  it("refuses an acceptanceCommit that is not a commit of the repository", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    const { report } = passed(cwd, base, "b".repeat(40), [PRUNE]);
    expect(report).toMatchObject({
      outcome: "refused",
      reason: expect.stringContaining("b".repeat(40)),
    });
  });

  it("accepts any X.Y.Z release of the acceptance-request format", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    const stdin = JSON.stringify({
      ...valid,
      $schema: "https://docs.phax.run/schemas/acceptance-request/9.9.9.json",
      base,
      files: [PRUNE],
    });
    expect(answerOf(run(cwd, stdin).stdout).outcome).toBe("checked");
  });
});

describe("examples/vitest-acceptance, stability", () => {
  it("prints identical stdout for the same request twice", () => {
    const cwd = makeRepo();
    const base = commit(cwd, { [PRUNE]: PRUNE_BASE });
    edit(cwd, {
      [PRUNE]: PRUNE_BASE.replace("[1, 2]", "[1, 2, 3]"),
      [REFUNDS]: REFUNDS_ACCEPTANCE.replaceAll("test.fails(", "test("),
    });
    const first = authored(cwd, base, [PRUNE, REFUNDS]);
    const second = authored(cwd, base, [PRUNE, REFUNDS]);
    expect(first.stdout).toBe(second.stdout);
    expect(checkedFindings(first.report)).toHaveLength(3);
  });
});

describe("phax's own acceptance declaration", () => {
  it("declares the example as the acceptance command and the example answers there", () => {
    const decoded = decodePhaxConfig(JSON.parse(readFileSync(join(repoRoot, "phax.json"), "utf8")));
    if (Either.isLeft(decoded)) throw new Error("phax.json does not decode");
    const command = decoded.right.acceptance?.command;
    expect(command).toBe("node examples/vitest-acceptance/main.mjs");

    const [file, ...args] = (command ?? "").split(/\s+/);
    const request = authoredRequest(git(repoRoot, ["rev-parse", "HEAD"]), [
      "tests/integration/exampleProviders.test.ts",
    ]);
    const { stdout, status } = spawnSync(file ?? "", args, {
      input: request,
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(answerOf(stdout)).toMatchObject({ outcome: "checked", findings: [] });
    expect(status).toBe(0);
  });
});

describe("the example stays outside the CLI", () => {
  it("is named and imported by no file under src/", () => {
    const offenders = readdirSync(join(repoRoot, "src"), { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".ts"))
      .filter((path) => {
        const text = readFileSync(join(repoRoot, "src", path), "utf8");
        return (
          /examples\/vitest-acceptance/.test(text) || /from\s+["'][^"']*\/examples\//.test(text)
        );
      });
    expect(offenders).toEqual([]);
  });

  it.each(["package.json", "npm/package.json"])("%s ships no examples folder", (file) => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, file), "utf8")) as {
      files?: readonly string[];
    };
    expect((manifest.files ?? []).filter((entry) => /(^|\/)examples/.test(entry))).toEqual([]);
  });

  it("is not part of phax's command spec", () => {
    expect(readFileSync(join(repoRoot, "phax.usage.kdl"), "utf8")).not.toContain(
      "vitest-acceptance",
    );
  });
});
