import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Either } from "effect";
import { readGateDiagnosticsAnswer } from "../../src/schemas/persisted.js";
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

describe("examples/hello-world audit provider", () => {
  const auditScript = join(exampleDir, "audit.mjs");

  // Read as phax reads a gate step's document: accepted means the example's
  // stamp names an answer release this build reads.
  it("prints an empty diagnostics list on the example tree (no src/ node: imports)", () => {
    const { stdout, status } = runScript(auditScript, TERMINAL_REQUEST, exampleDir);
    expect(status).toBe(0);
    expect(readGateDiagnosticsAnswer(JSON.parse(stdout))).toEqual(
      Either.right({ diagnostics: [] }),
    );
  });

  it("reports one HW_NO_IO invariant for a node: import in a temp copy with a violating file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "phax-hw-"));
    cpSync(exampleDir, tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src/x.ts"), 'import { readFileSync } from "node:fs";\n');

    const { stdout, status } = runScript(auditScript, TERMINAL_REQUEST, tmpDir);
    expect(status).toBe(0);
    const result = readGateDiagnosticsAnswer(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const [finding, ...rest] = result.right.diagnostics;
      expect(rest).toEqual([]);
      expect(finding?.rule).toBe("HW_NO_IO");
      expect(finding?.class).toBe("invariant");
      expect(finding?.location).toEqual({ file: "src/x.ts", line: 1 });
    }
  });

  describe("scoped by the gate request's base", () => {
    function repoWithCleanBase(): { dir: string; base: string } {
      const dir = mkdtempSync(join(tmpdir(), "phax-hw-base-"));
      cpSync(auditScript, join(dir, "audit.mjs"));
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
      const result = readGateDiagnosticsAnswer(JSON.parse(stdout));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.diagnostics.map((d) => d.location.file)).toEqual(["src/io.ts"]);
      }
    });

    it("prints no finding when nothing changed since a base that already holds the file", () => {
      const { dir } = repoWithCleanBase();
      writeFileSync(join(dir, "src/io.ts"), 'import { readFileSync } from "node:fs";\n');
      git(["add", "src/io.ts"], dir);
      git(["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "io"], dir);
      const base = git(["rev-parse", "HEAD"], dir);

      const { stdout, status } = runScript("audit.mjs", gateRequest(base, false), dir);
      expect(status).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.$schema).toMatch(/^https:\/\/docs\.phax\.run\/schemas\/gate-diagnostics\//);
      expect(readGateDiagnosticsAnswer(parsed)).toEqual(Either.right({ diagnostics: [] }));
    });
  });
});

describe("examples/hello-world phax.json", () => {
  it("ships exactly the scripts for the hooks it declares", () => {
    const scripts = readdirSync(exampleDir)
      .filter((f) => f.endsWith(".mjs"))
      .toSorted();
    expect(scripts).toEqual(["audit-plan.mjs", "audit.mjs"]);
  });

  it("decodes with decodePhaxConfig and has planAuditor and a diagnostics step", () => {
    const raw = JSON.parse(readFileSync(join(exampleDir, "phax.json"), "utf8"));
    const result = decodePhaxConfig(raw);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const config = result.right;
      expect(config.planAuditor?.command).toBe("node ./audit-plan.mjs");
      const steps = config.gateProfiles?.["standard"] ?? [];
      const diagStep = steps.find((s) => s.output === "diagnostics");
      expect(diagStep?.command).toBe("node ./audit.mjs");
      expect(diagStep?.input).toBe("gate-request");
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
