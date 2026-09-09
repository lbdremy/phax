import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Either } from "effect";
import { decodeOrientIndexResponse, decodeOrientExpandResponse } from "../../src/schemas/orient.js";
import { decodeGateDiagnosticsDocument } from "../../src/schemas/gateDiagnostics.js";
import { decodePhaxConfig } from "../../src/schemas/phaxConfig.js";
import { decodeScopesResponse } from "../../src/schemas/scopes.js";
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

describe("examples/hello-world orient provider", () => {
  const orientScript = join(exampleDir, "orient.mjs");

  it("decodes an index response for src/greet.ts", () => {
    const { stdout, status } = runScript(
      orientScript,
      JSON.stringify({ files: ["src/greet.ts"] }),
      exampleDir,
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    const result = decodeOrientIndexResponse(parsed);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.rows.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("decodes an expand response for a known row id", () => {
    const indexPayload = JSON.stringify({ files: ["src/greet.ts"] });
    const { stdout: indexStdout } = runScript(orientScript, indexPayload, exampleDir);
    const indexResult = decodeOrientIndexResponse(JSON.parse(indexStdout));
    expect(Either.isRight(indexResult)).toBe(true);
    if (Either.isLeft(indexResult)) return;

    const rowId = indexResult.right.rows[0]!.id;
    const { stdout, status } = runScript(
      orientScript,
      JSON.stringify({ expand: rowId }),
      exampleDir,
    );
    expect(status).toBe(0);
    const result = decodeOrientExpandResponse(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.row).not.toBeNull();
      expect(result.right.row?.body).toBeTruthy();
    }
  });

  it("decodes an expand response for an unknown id as null row", () => {
    const { stdout, status } = runScript(
      orientScript,
      JSON.stringify({ expand: "unknown-id-that-does-not-exist" }),
      exampleDir,
    );
    expect(status).toBe(0);
    const result = decodeOrientExpandResponse(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.row).toBeNull();
    }
  });
});

describe("examples/hello-world audit provider", () => {
  const auditScript = join(exampleDir, "audit.mjs");

  it("decodes an empty diagnostics list on the example tree (no src/ node: imports)", () => {
    const { stdout, status } = runScript(auditScript, "", exampleDir);
    expect(status).toBe(0);
    const result = decodeGateDiagnosticsDocument(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.diagnostics).toHaveLength(0);
    }
  });

  it("reports HW_NO_IO for a node: import in a temp copy with a violating file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "phax-hw-"));
    cpSync(exampleDir, tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src/x.ts"), 'import { readFileSync } from "node:fs";\n');

    const { stdout, status } = runScript(auditScript, "", tmpDir);
    expect(status).toBe(0);
    const result = decodeGateDiagnosticsDocument(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const diags = result.right.diagnostics;
      expect(diags.length).toBeGreaterThanOrEqual(1);
      const d = diags[0]!;
      expect(d.rule).toBe("HW_NO_IO");
      expect(d.location.line).toBeGreaterThan(0);
    }
  });
});

describe("examples/hello-world phax.json", () => {
  it("decodes with decodePhaxConfig and has orient, scopes and a diagnostics step", () => {
    const raw = JSON.parse(readFileSync(join(exampleDir, "phax.json"), "utf8"));
    const result = decodePhaxConfig(raw);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const config = result.right;
      expect(config.orient).toBeDefined();
      expect(config.orient?.command).toBeTruthy();
      expect(config.scopes).toBeDefined();
      expect(config.scopes?.command).toBeTruthy();
      expect(config.planAuditor).toBeDefined();
      expect(config.planAuditor?.command).toBeTruthy();
      const steps = config.gateProfiles?.["standard"] ?? [];
      const diagStep = steps.find((s) => s.output === "diagnostics");
      expect(diagStep).toBeDefined();
    }
  });
});

describe("examples/hello-world scopes provider", () => {
  const scopesScript = join(exampleDir, "scopes.mjs");

  it("decodes a closed-scopes response and closes the greet scope at phase-01", () => {
    const request = JSON.stringify({
      phase: "phase-01",
      phases: [
        { id: "phase-01", files: ["src/greet.ts"] },
        { id: "phase-02", files: ["tests/greet.test.ts"] },
      ],
    });
    const { stdout, status } = runScript(scopesScript, request, exampleDir);
    expect(status).toBe(0);
    const result = decodeScopesResponse(JSON.parse(stdout));
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.closed).toEqual(["greet"]);
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
