import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId, type RunId } from "../../src/domain/branded.js";
import { GateAttemptsExhaustedError, GateStepRefusedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { currentSchemaUrl, readPhaxPlanFile } from "../../src/schemas/persisted.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";

// A report step that refuses to run, on fakes over a real run folder. The
// report and the run are made up, after the spec's examples.

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Phase completed successfully.",
  "## Key decisions and why",
  "No major decisions.",
  "## Exact locations (file paths and exported names)",
  "No new exports.",
  "## What the next phase needs to know",
  "Ready to proceed.",
].join("\n");

const AUDIT = "node ./audit.mjs";
const REASON = "the checks need hw-rules 2, and 1 is installed";
const REMEDY = "pnpm add -D hw-rules@2";

const refusedReport = JSON.stringify({
  $schema: currentSchemaUrl("gate-report"),
  outcome: "refused",
  reason: REASON,
  remedy: REMEDY,
});

const failingReport = JSON.stringify({
  $schema: currentSchemaUrl("gate-report"),
  outcome: "checked",
  findings: [
    {
      id: "exports-function src/farewell.ts",
      rule: "a module under src/ exports its function",
      location: { file: "src/farewell.ts", lines: null },
      message: "no exported function",
      related: [],
      guide: null,
    },
  ],
  review: [],
});

const shortName = Either.getOrThrow(decodeShortName("greet"));

const plan: PhaxPlan = Either.getOrThrow(
  readPhaxPlanFile("phax-plan.json", {
    version: 1,
    run: { shortName: "greet", title: "Greet", branch: "ai/greet", requiredCommands: [] },
    phases: [
      {
        id: "phase-01",
        title: "Phase 1",
        model: "claude-sonnet-4-6",
        effort: "low",
        planMarkdownAnchor: "#phase-01",
        plannedFilesToCreate: ["src/greet.ts"],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "feat: greet", body: "Greet." },
      },
    ],
  }),
);

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "hello-world",
      state: { root: stateRoot },
      gateProfiles: {
        full: [
          { command: AUDIT, surface: "structural", firing: "every-phase", output: "gate-report" },
        ],
      },
    },
    stateRoot,
    namespace: "hello-world",
    repoRoot: stateRoot,
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    security: {
      profile: "secure",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  };
}

const session = (id: string) => ({
  sessionId: id as ClaudeSessionId,
  outputPath: "",
  finalText: "",
});

describe("a refused gate report", () => {
  let stateRoot: string;
  let worktreePath: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-gate-refusal-"));
    worktreePath = join(stateRoot, "worktrees", "hello-world.greet", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });
    await writeFile(join(worktreePath, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  async function setup() {
    const config = makeConfig(stateRoot);
    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse(AUDIT, { exitCode: 0, stdout: refusedReport, stderr: "" });
    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse(session("sess-01"));
    for (let i = 0; i < 4; i++) fakeBackend.impl.addResumeResponse(session(`sess-01-${i}`));

    const layer = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Greet", plan, config, undefined, true).pipe(
        Effect.provide(layer),
      ),
    );
    const execute = (id: RunId) =>
      Effect.runPromise(
        Effect.either(
          executePlan({
            shortName,
            namespace: "hello-world",
            plan,
            planMd: "# Greet",
            config,
            gateProfileId: "full",
            allowDirty: false,
            runPath,
            runId: id,
            startIndex: 0,
            securityMode: "secure",
          }).pipe(Effect.provide(layer)),
        ),
      );
    const readJson = async (...segments: string[]) =>
      JSON.parse(await readFile(join(runPath, ...segments), "utf8")) as Record<string, unknown>;
    return { runPath, runId, execute, readJson, fakeShell, fakeBackend };
  }

  it("stops the phase without a fix attempt, naming the step, the reason and the remedy", async () => {
    const { runId, execute, readJson, fakeBackend } = await setup();

    const result = await execute(runId);

    if (Either.isRight(result)) throw new Error("expected the run to stop");
    expect(result.left).toBeInstanceOf(GateStepRefusedError);
    expect(result.left).toMatchObject({
      command: AUDIT,
      reason: REASON,
      remedy: REMEDY,
      phaseId: "phase-01",
    });
    // maxFixAttempts is 3, and no fix prompt is sent.
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
    expect(await readJson("phase-01", "gate-attribution.json")).toMatchObject({
      phase: "phase-01",
      steps: [{ command: AUDIT, surface: "structural", result: "refused" }],
    });
  });

  it("pauses like exhaustion, and resume runs the gate first with the full fix budget", async () => {
    const { runPath, runId, execute, readJson, fakeShell, fakeBackend } = await setup();

    await execute(runId);

    expect(await readJson("run-status.json")).toMatchObject({
      state: "interrupted",
      stoppedReason: "gates_exhausted",
      lastError: `Gate step refused: ${AUDIT} — ${REASON}`,
    });
    expect(await readJson("phase-01", "status.json")).toMatchObject({ state: "gates_exhausted" });
    const instructions = await readFile(join(runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain(`\`${AUDIT}\` refused to run`);
    expect(instructions).toContain(REASON);
    expect(instructions).toContain(REMEDY);
    expect(instructions).toContain("phax resume greet");

    // The step no longer refuses, but fails on a finding.
    fakeShell.impl.setResponse(AUDIT, { exitCode: 1, stdout: failingReport, stderr: "" });
    const statusPath = join(runPath, "phase-01", "status.json");
    const status = await readJson("phase-01", "status.json");
    await writeFile(statusPath, JSON.stringify({ ...status, claudeSessionId: "sess-01" }));
    const auditCallsBefore = fakeShell.impl.calls.filter((c) => c.command[0] === "node").length;

    const resumed = await execute(runId);

    if (Either.isRight(resumed)) throw new Error("expected the resumed gate to stay red");
    expect(resumed.left).toBeInstanceOf(GateAttemptsExhaustedError);
    // No fresh agent turn: the gate ran first, then each of the 3 fix
    // attempts followed a failure and re-ran it.
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(3);
    expect(fakeBackend.impl.resumeCalls[0]?.prompt).toContain("- src/farewell.ts");
    const auditCalls = fakeShell.impl.calls.filter((c) => c.command[0] === "node").length;
    expect(auditCalls - auditCallsBefore).toBe(4);
  });
});
