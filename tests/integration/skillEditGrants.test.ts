import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId } from "../../src/domain/branded.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
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
import { decodePhaxPlan, type PhaxPlan } from "../../src/schemas/phaxPlan.js";
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

const SKILL_FILE = ".claude/skills/foo/SKILL.md";

const shortName = Either.getOrThrow(decodeShortName("grant-run"));

function makePlan(plannedFilesToEdit: readonly string[]): PhaxPlan {
  return Either.getOrThrow(
    decodePhaxPlan({
      version: 1,
      run: {
        shortName: "grant-run",
        title: "Grant Run",
        branch: "ai/grant-run",
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
          plannedFilesToEdit,
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase 1", body: "Phase 1." },
        },
      ],
    }),
  );
}

function makeConfig(stateRoot: string, gateCommand: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root: stateRoot },
      gateProfiles: {
        full: [{ command: gateCommand, surface: "local", firing: "every-phase", output: "log" }],
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
      profile: "unsafe",
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

describe("executePlan — skill edit grants wiring", () => {
  let stateRoot: string;
  let worktreePath: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-skill-grants-"));
    worktreePath = join(stateRoot, "worktrees", "test-project.grant-run", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });
    await writeFile(join(worktreePath, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  async function runPlan(opts: { plan: PhaxPlan; gateCommand?: string; codex?: boolean }) {
    const gateCommand = opts.gateCommand ?? "true";
    const config = makeConfig(stateRoot, gateCommand);

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("false", { exitCode: 1, stdout: "", stderr: "gate failed" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });
    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse(session("sess-01"));
    fakeBackend.impl.addResumeResponse(session("sess-01-a"));
    fakeBackend.impl.addResumeResponse(session("sess-01-b"));

    const layer = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Grant Run", opts.plan, config, undefined, true).pipe(
        Effect.provide(layer),
      ),
    );
    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan: opts.plan,
          planMd: "# Grant Run",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
          allowSkillEdits: true,
          ...(opts.codex === true
            ? {
                providerConfig: {
                  providers: {
                    ...DEFAULT_PROVIDER_CONFIG.providers,
                    "codex-cli": {
                      ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!,
                      enabled: true,
                    },
                  },
                },
              }
            : {}),
        }).pipe(Effect.provide(layer)),
      ),
    );
    const posture = Either.getOrThrow(
      decodeSecurityPosture(
        JSON.parse(await readFile(join(runPath, "phase-01", "security.json"), "utf8")),
      ),
    );
    return { result, fakeBackend, posture };
  }

  it("passes the phase's declared skill files to runAgent and records them in security.json", async () => {
    const { result, fakeBackend, posture } = await runPlan({
      plan: makePlan([SKILL_FILE, "src/x.ts"]),
    });

    expect(Either.isRight(result)).toBe(true);
    expect(fakeBackend.impl.runCalls[0]?.options.skillEditGrants).toEqual([SKILL_FILE]);
    expect(posture.skillEditGrants).toEqual([SKILL_FILE]);
  });

  it("passes [] when the phase declares no skill files", async () => {
    const { fakeBackend, posture } = await runPlan({ plan: makePlan(["src/x.ts"]) });

    expect(fakeBackend.impl.runCalls[0]?.options.skillEditGrants).toEqual([]);
    expect(posture.skillEditGrants).toEqual([]);
  });

  it("keeps the grant on the fix-loop resumeAgentSession call", async () => {
    const { fakeBackend } = await runPlan({
      plan: makePlan([SKILL_FILE, "src/x.ts"]),
      gateCommand: "false",
    });

    expect(fakeBackend.impl.resumeCalls.length).toBeGreaterThan(0);
    expect(fakeBackend.impl.resumeCalls[0]?.options.skillEditGrants).toEqual([SKILL_FILE]);
  });

  it("records and passes the grant unchanged for a phase routed to codex", async () => {
    const { fakeBackend, posture } = await runPlan({
      plan: makePlan([SKILL_FILE, "src/x.ts"]),
      codex: true,
    });

    expect(fakeBackend.impl.runCalls[0]?.options.provider).toBe("codex-cli");
    expect(fakeBackend.impl.runCalls[0]?.options.skillEditGrants).toEqual([SKILL_FILE]);
    expect(posture.provider).toBe("codex-cli");
    expect(posture.skillEditGrants).toEqual([SKILL_FILE]);
  });
});
