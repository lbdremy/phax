import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId, type RunId } from "../../src/domain/branded.js";
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
import { decodeSecurityPosture } from "../../src/schemas/securityPosture.js";

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

const GATE_COMMAND = "pnpm test";

const shortName = Either.getOrThrow(decodeShortName("grants-run"));

const plan: PhaxPlan = Either.getOrThrow(
  readPhaxPlanFile("phax-plan.json", {
    version: 1,
    run: {
      shortName: "grants-run",
      title: "Grants Run",
      branch: "ai/grants-run",
      requiredCommands: [],
    },
    phases: [
      {
        id: "phase-01",
        title: "Phase 1",
        model: "claude-sonnet-4-6",
        effort: "low",
        planMarkdownAnchor: "#phase-01",
        plannedFilesToCreate: [],
        plannedFilesToEdit: ["src/x.ts"],
        optionalFilesToEdit: [],
        commit: { subject: "feat: phase 1", body: "Phase 1." },
      },
    ],
  }),
);

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root: stateRoot },
      gateProfiles: {
        full: [{ command: GATE_COMMAND, surface: "local", firing: "every-phase", output: "log" }],
      },
    },
    stateRoot,
    namespace: "test-project",
    repoRoot: stateRoot,
    maxFixAttempts: 1,
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
      agentCommands: ["node"],
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

const EXPECTED_RECORDS = [
  {
    command: "node",
    source: "config",
    explicit: true,
    requiredByPlan: false,
    enforcement: "prefix",
    degraded: false,
  },
  {
    command: GATE_COMMAND,
    source: "gate",
    explicit: false,
    requiredByPlan: false,
    enforcement: "prefix",
    degraded: false,
  },
];

describe("executePlan — agent command grants in secure mode", () => {
  let stateRoot: string;
  let worktreePath: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-agent-command-grants-"));
    worktreePath = join(stateRoot, "worktrees", "test-project.grants-run", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });
    await writeFile(join(worktreePath, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("grants exactly the config and gate commands on a fresh start and on resume", async () => {
    const config = makeConfig(stateRoot);

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    const fakeShell = makeFakeShell();
    // The gate never passes, so phase-01 stops with its gate exhausted.
    fakeShell.impl.setResponse(GATE_COMMAND, { exitCode: 1, stdout: "", stderr: "gate failed" });
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
      createRunFolder(shortName, "# Grants Run", plan, config, undefined, true).pipe(
        Effect.provide(layer),
      ),
    );
    const execute = (id: RunId) =>
      Effect.runPromise(
        Effect.either(
          executePlan({
            shortName,
            namespace: "test-project",
            plan,
            planMd: "# Grants Run",
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
    const readPosture = async () =>
      Either.getOrThrow(
        decodeSecurityPosture(
          JSON.parse(await readFile(join(runPath, "phase-01", "security.json"), "utf8")),
        ),
      );
    const phaseState = async () =>
      (
        JSON.parse(await readFile(join(runPath, "phase-01", "status.json"), "utf8")) as {
          state: string;
        }
      ).state;

    // Fresh start.
    const fresh = await execute(runId);
    expect(Either.isLeft(fresh)).toBe(true);
    expect(await phaseState()).toBe("gates_exhausted");
    expect((await readPosture()).mode).toBe("secure");
    expect((await readPosture()).agentCommands).toEqual(EXPECTED_RECORDS);
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    expect(fakeBackend.impl.runCalls[0]?.options.agentCommands).toEqual(["node", GATE_COMMAND]);

    // The real session writer records the session id on the phase status;
    // the fake backend does not, so record it as that writer would.
    const statusPath = join(runPath, "phase-01", "status.json");
    const status = JSON.parse(await readFile(statusPath, "utf8")) as Record<string, unknown>;
    await writeFile(statusPath, JSON.stringify({ ...status, claudeSessionId: "sess-01" }));

    // Resume from gates_exhausted re-enters the session with the same grants.
    const resumeCallsBefore = fakeBackend.impl.resumeCalls.length;
    await execute(runId);
    const resumeCalls = fakeBackend.impl.resumeCalls.slice(resumeCallsBefore);
    expect(resumeCalls.length).toBeGreaterThan(0);
    for (const call of resumeCalls) {
      expect(call.options.agentCommands).toEqual(["node", GATE_COMMAND]);
    }
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    expect((await readPosture()).agentCommands).toEqual(EXPECTED_RECORDS);
  });

  it("grants nothing because a gate report or its guide names a command", async () => {
    const reportCommand = "node ./audit.mjs";
    const base = makeConfig(stateRoot);
    const config: ResolvedConfig = {
      ...base,
      raw: {
        ...base.raw,
        gateProfiles: {
          full: [
            {
              command: reportCommand,
              surface: "structural",
              firing: "every-phase",
              output: "gate-report",
            },
          ],
        },
      },
    };
    // A made-up failing report whose rule, message, related why and guide all
    // name commands the agent was never granted.
    const report = JSON.stringify({
      $schema: currentSchemaUrl("gate-report"),
      outcome: "checked",
      findings: [
        {
          id: "lint src/x.ts",
          rule: "pnpm exec hw-lint passes on src/x.ts",
          location: { file: "src/x.ts", lines: null },
          message: "run pnpm exec hw-lint --fix",
          related: [{ file: "package.json", lines: null, why: "npx hw-fix is declared here" }],
          guide: { summary: "run cargo fix, then make", read: "guides/hw-fix.md" },
        },
      ],
      review: [{ owner: "hw-maintainers", note: "consider pip install hw-tools" }],
    });

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse(reportCommand, { exitCode: 1, stdout: report, stderr: "" });
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
      createRunFolder(shortName, "# Grants Run", plan, config, undefined, true).pipe(
        Effect.provide(layer),
      ),
    );
    await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# Grants Run",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
          securityMode: "secure",
        }).pipe(Effect.provide(layer)),
      ),
    );

    const granted = ["node", reportCommand];
    expect(fakeBackend.impl.runCalls[0]?.options.agentCommands).toEqual(granted);
    expect(fakeBackend.impl.resumeCalls.length).toBeGreaterThan(0);
    for (const call of fakeBackend.impl.resumeCalls) {
      expect(call.options.agentCommands).toEqual(granted);
    }
    const posture = Either.getOrThrow(
      decodeSecurityPosture(
        JSON.parse(await readFile(join(runPath, "phase-01", "security.json"), "utf8")),
      ),
    );
    expect(posture.agentCommands.map((record) => record.command)).toEqual(granted);
  });
});
