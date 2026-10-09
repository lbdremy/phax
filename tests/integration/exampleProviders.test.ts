import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Either } from "effect";
import { parseBriefReport, parseGateReport } from "../../packages/schemas/src/index.js";
import {
  currentSchemaUrl,
  describeReportError,
  readBriefReport,
  readGateReport,
} from "../../src/schemas/persisted.js";
import { decodePhaxConfig } from "../../src/schemas/phaxConfig.js";
import { decodePlanAuditResponse } from "../../src/schemas/planAudit.js";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";
import { finalizeExtractedPlan } from "../../src/domain/plan/finalize.js";
import { makePlanAuditRequest } from "../../src/domain/plan/projection.js";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const exampleDir = join(repoRoot, "examples/hello-world");

function runScript(
  script: string,
  stdinPayload: string,
  cwd: string,
): { stdout: string; status: number } {
  try {
    const stdout = execSync(`node "${script}"`, {
      input: stdinPayload,
      cwd,
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

// A made-up gate request; only `base` and `terminal` steer the example audit.
function gateRequest(base: string, terminal: boolean): string {
  return JSON.stringify({
    $schema: "https://docs.phax.run/schemas/gate-request/0.20.0.json",
    phase: "phase-01",
    base,
    terminal,
    phases: [{ id: "phase-01", files: ["src/greet.ts"] }],
  });
}

const TERMINAL_REQUEST = gateRequest("0".repeat(40), true);

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// Read as phax reads a report step's output, and as a consumer reads it
// through the schemas package.
function reportOf(stdout: string) {
  const printed: unknown = JSON.parse(stdout);
  expect(parseGateReport(printed).ok).toBe(true);
  const result = readGateReport(printed);
  if (Either.isLeft(result)) throw new Error(describeReportError(result.left));
  if (result.right.outcome !== "checked") throw new Error("expected a checked report");
  return result.right;
}

describe("examples/hello-world audit provider", () => {
  const auditScript = join(exampleDir, "audit.mjs");

  it("prints a checked gate report with no finding on the example tree (no src/)", () => {
    const { stdout, status } = runScript(auditScript, TERMINAL_REQUEST, exampleDir);
    expect(status).toBe(0);
    expect(reportOf(stdout)).toEqual({
      $schema: currentSchemaUrl("gate-report"),
      outcome: "checked",
      findings: [],
      review: [],
    });
  });

  it("reports both rules over the files it audits, with the shipped guide", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "phax-hw-"));
    cpSync(exampleDir, tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/greet.ts"),
      [
        'import { readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'import { existsSync } from "node:fs";',
        "export function greet(name: string): string {",
        "  return `Hello, ${name}!`;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(join(tmpDir, "src/farewell.ts"), "const bye = 'bye';\n");

    const { stdout, status } = runScript(auditScript, TERMINAL_REQUEST, tmpDir);
    expect(status).toBe(0);
    const guide = { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" };
    expect(reportOf(stdout).findings).toEqual([
      {
        id: "exports-function src/farewell.ts",
        rule: "a module under src/ exports its function",
        location: { file: "src/farewell.ts", lines: null },
        message: "no exported function",
        related: [],
        guide: null,
      },
      {
        id: "no-node-import src/greet.ts node:fs",
        rule: "a module under src/ imports no node: module",
        location: { file: "src/greet.ts", lines: [1, 1] },
        message: "imports node:fs",
        related: [],
        guide,
      },
      {
        id: "no-node-import src/greet.ts node:path",
        rule: "a module under src/ imports no node: module",
        location: { file: "src/greet.ts", lines: [2, 2] },
        message: "imports node:path",
        related: [],
        guide,
      },
    ]);
    // The guide the findings name ships with the example.
    expect(existsSync(join(exampleDir, guide.read))).toBe(true);

    // Ids are stable across runs.
    expect(runScript(auditScript, TERMINAL_REQUEST, tmpDir).stdout).toBe(stdout);
  });

  describe("scoped by the gate request's base", () => {
    function repoWithCleanBase(): { dir: string; base: string } {
      const dir = mkdtempSync(join(tmpdir(), "phax-hw-base-"));
      cpSync(auditScript, join(dir, "audit.mjs"));
      cpSync(join(exampleDir, "rules.mjs"), join(dir, "rules.mjs"));
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src/greet.ts"), "export const greet = () => 'hi';\n");
      git(["init", "-q"], dir);
      git(["add", "."], dir);
      git(
        ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base"],
        dir,
      );
      return { dir, base: git(["rev-parse", "HEAD"], dir) };
    }

    it("names a file added since base when the phase is not terminal", () => {
      const { dir, base } = repoWithCleanBase();
      writeFileSync(join(dir, "src/io.ts"), 'import { readFileSync } from "node:fs";\n');
      writeFileSync(join(dir, "request.json"), gateRequest(base, false));

      const stdout = execSync("node ./audit.mjs < request.json", { cwd: dir, encoding: "utf8" });
      expect(reportOf(stdout).findings.map((f) => f.id)).toEqual([
        "no-node-import src/io.ts node:fs",
        "exports-function src/io.ts",
      ]);
    });

    it("prints no finding when nothing changed since a base that already holds the file", () => {
      const { dir } = repoWithCleanBase();
      writeFileSync(join(dir, "src/io.ts"), 'import { readFileSync } from "node:fs";\n');
      git(["add", "src/io.ts"], dir);
      git(["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "io"], dir);
      const base = git(["rev-parse", "HEAD"], dir);

      const { stdout, status } = runScript("audit.mjs", gateRequest(base, false), dir);
      expect(status).toBe(0);
      expect(reportOf(stdout).findings).toEqual([]);
    });
  });
});

// A made-up brief request: phase facts (phase-02 of three) and `files`, or,
// outside a phase, `files` alone.
const BRIEF_PHASES = [
  { id: "phase-01", files: ["src/greet.ts"] },
  { id: "phase-02", files: ["src/io.ts", "tests/io.test.ts"] },
  { id: "phase-03", files: ["src/later.ts"] },
];

function phaseBriefRequest(files: readonly string[] | null): string {
  return JSON.stringify({
    $schema: "https://docs.phax.run/schemas/brief-request/0.20.0.json",
    phase: "phase-02",
    base: "0".repeat(40),
    terminal: false,
    phases: BRIEF_PHASES,
    files,
  });
}

function outsideBriefRequest(files: readonly string[]): string {
  return JSON.stringify({
    $schema: "https://docs.phax.run/schemas/brief-request/0.20.0.json",
    files,
  });
}

describe("examples/hello-world brief provider", () => {
  const briefScript = join(exampleDir, "brief.mjs");

  // A temp copy of the example holding src/io.ts, which imports node:fs on line 2.
  function copyWithIo(): string {
    const dir = mkdtempSync(join(tmpdir(), "phax-hw-brief-"));
    cpSync(exampleDir, dir, { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src/io.ts"),
      'export const x = 1;\nimport { readFileSync } from "node:fs";\n',
    );
    return dir;
  }

  // Read as phax reads a brief, by the report's own $schema, and as a
  // consumer reads it through the schemas package.
  function briefOf(stdinPayload: string, cwd: string) {
    const { stdout, status } = runScript(briefScript, stdinPayload, cwd);
    expect(status).toBe(0);
    const printed: unknown = JSON.parse(stdout);
    expect(parseBriefReport(printed).ok).toBe(true);
    const result = readBriefReport(printed);
    if (Either.isLeft(result)) throw new Error(describeReportError(result.left));
    expect(result.right.$schema).toBe(currentSchemaUrl("brief-report"));
    return result.right;
  }

  const guide = { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" };

  function rulesOver(files: readonly string[]) {
    return [
      { rule: "a module under src/ exports its function", files, guide: null },
      { rule: "a module under src/ imports no node: module", files, guide },
    ];
  }

  it("answers both rules over the named files and the greet finding, due null outside a phase", () => {
    const dir = mkdtempSync(join(tmpdir(), "phax-hw-brief-"));
    cpSync(exampleDir, dir, { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src/greet.ts"),
      'import { readFileSync } from "node:fs";\nexport function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n',
    );

    const report = briefOf(JSON.stringify({ files: ["src/greet.ts", "src/farewell.ts"] }), dir);

    expect(report.rules).toEqual(rulesOver(["src/greet.ts", "src/farewell.ts"]));
    expect(report.findings).toEqual([
      {
        id: "no-node-import src/greet.ts node:fs",
        rule: "a module under src/ imports no node: module",
        location: { file: "src/greet.ts", lines: [1, 1] },
        message: "imports node:fs",
        related: [],
        guide,
        due: null,
      },
    ]);
    expect(existsSync(join(exampleDir, guide.read))).toBe(true);
  });

  it("briefs the gated phase's planned files under src/ when files is null, due this phase", () => {
    const report = briefOf(phaseBriefRequest(null), copyWithIo());
    expect(report.rules).toEqual(rulesOver(["src/io.ts"]));
    expect(report.findings.map((f) => [f.id, f.location.lines, f.due])).toEqual([
      ["no-node-import src/io.ts node:fs", [2, 2], "this-phase"],
      ["exports-function src/io.ts", null, "this-phase"],
    ]);
  });

  it("dates a finding only a later phase plans as due later", () => {
    const dir = copyWithIo();
    writeFileSync(join(dir, "src/later.ts"), 'import "node:path";\nexport function later() {}\n');
    const report = briefOf(phaseBriefRequest(["src/later.ts"]), dir);
    expect(report.findings).toMatchObject([
      { id: "no-node-import src/later.ts node:path", due: "later" },
    ]);
  });

  it("prints ids stable across runs", () => {
    const dir = copyWithIo();
    const payload = phaseBriefRequest(["src/io.ts"]);
    expect(runScript(briefScript, payload, dir).stdout).toBe(
      runScript(briefScript, payload, dir).stdout,
    );
  });

  it("has nothing to report on a path not under src/", () => {
    const report = briefOf(outsideBriefRequest(["README.md"]), copyWithIo());
    expect(report).toEqual({ $schema: currentSchemaUrl("brief-report"), rules: [], findings: [] });
  });
});

describe("examples/hello-world phax.json", () => {
  it("ships exactly the scripts for the hooks it declares", () => {
    const scripts = readdirSync(exampleDir)
      .filter((f) => f.endsWith(".mjs"))
      .toSorted();
    // rules.mjs is no hook: audit.mjs and brief.mjs import it.
    expect(scripts).toEqual(["audit-plan.mjs", "audit.mjs", "brief.mjs", "rules.mjs"]);
  });

  it("decodes with decodePhaxConfig and has brief, planAuditor and a report step", () => {
    const raw = JSON.parse(readFileSync(join(exampleDir, "phax.json"), "utf8"));
    const result = decodePhaxConfig(raw);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const config = result.right;
      expect(config.brief).toEqual({ command: "node ./brief.mjs", push: "findings-and-rules" });
      expect(config.planAuditor?.command).toBe("node ./audit-plan.mjs");
      const steps = config.gateProfiles?.["standard"] ?? [];
      const reportStep = steps.find((s) => s.output === "gate-report");
      expect(reportStep?.command).toBe("node ./audit.mjs");
      expect(reportStep?.input).toBe("gate-request");
    }
  });
});

describe("examples/hello-world plan auditor", () => {
  const auditPlanScript = join(exampleDir, "audit-plan.mjs");

  // Project the example plan.md exactly as `phax plans lint` would, rather
  // than hand-writing a projection: a phase added to or dropped from the
  // example then shows up here instead of silently drifting past the test.
  function helloWorldProjection(): { phases: readonly { id: string; files: readonly string[] }[] } {
    const planMd = readFileSync(join(exampleDir, "plan.md"), "utf8");
    const extracted = extractPlanDeterministic(planMd);
    if (Either.isLeft(extracted)) {
      throw new Error(`examples/hello-world/plan.md no longer parses: ${extracted.left.message}`);
    }
    const finalized = finalizeExtractedPlan(extracted.right, planMd);
    if (Either.isLeft(finalized)) {
      throw new Error(
        `examples/hello-world/plan.md no longer finalizes: ${finalized.left.message}`,
      );
    }
    return makePlanAuditRequest(finalized.right.plan.phases);
  }

  it("finds no findings on the example plan's own projection", () => {
    const projection = helloWorldProjection();
    // Guards the premise: the example must still pair a src file with a test.
    expect(projection.phases.length).toBeGreaterThan(1);
    const { stdout, status } = runScript(auditPlanScript, JSON.stringify(projection), exampleDir);
    expect(status).toBe(0);
    const result = decodePlanAuditResponse(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.findings).toEqual([]);
    }
  });

  it("flags src/greet.ts once the test-bearing phase is dropped", () => {
    const projection = helloWorldProjection();
    const withoutTests = {
      phases: projection.phases.filter((phase) => !phase.files.some((f) => f.startsWith("tests/"))),
    };
    expect(withoutTests.phases.length).toBeLessThan(projection.phases.length);
    const { stdout, status } = runScript(auditPlanScript, JSON.stringify(withoutTests), exampleDir);
    expect(status).toBe(0);
    const result = decodePlanAuditResponse(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.findings).toHaveLength(1);
      const finding = result.right.findings[0]!;
      expect(finding.phases).toEqual(["phase-01"]);
      expect(finding.message).toContain("tests/greet.test.ts");
    }
  });
});
