import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type RunId } from "../../src/domain/branded.js";
import { SkillEditConsentError } from "../../src/domain/errors.js";
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
import { decodeRunStatus } from "../../src/schemas/status.js";

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

const shortName = Either.getOrThrow(decodeShortName("skill-run"));

function makePlan(skillPhaseIndex: number): PhaxPlan {
  const phase = (n: number) => ({
    id: `phase-0${n}`,
    title: `Phase ${n}`,
    model: "claude-sonnet-4-6",
    effort: "low" as const,
    planMarkdownAnchor: `#phase-0${n}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: n - 1 === skillPhaseIndex ? [SKILL_FILE, "src/x.ts"] : ["src/x.ts"],
    optionalFilesToEdit: [],
    commit: { subject: `feat: phase ${n}`, body: `Phase ${n}.` },
  });
  return Either.getOrThrow(
    decodePhaxPlan({
      version: 1,
      run: {
        shortName: "skill-run",
        title: "Skill Run",
        branch: "ai/skill-run",
        requiredCommands: [],
      },
      phases: [phase(1), phase(2)],
    }),
  );
}

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root: stateRoot },
      gateProfiles: {
        full: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
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

function makeLayers() {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  const fakeShell = makeFakeShell();
  fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
  const fakeBackend = makeFakeBackend();
  return {
    layer: Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    ),
    fakeGit,
    fakeBackend,
  };
}

// Mirrors `phax resume`: decode run-status.json and inherit the recorded consent.
async function readRecordedConsent(runPath: string): Promise<boolean> {
  const raw = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as unknown;
  const status = Either.getOrThrow(decodeRunStatus(raw));
  return status.allowSkillEdits === true;
}

// Simulate phase-01 already committed so executePlan can resume at phase-02.
async function markPhase01Committed(stateRoot: string, runPath: string): Promise<void> {
  const now = new Date().toISOString();
  const folder = join(runPath, "phase-01");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "status.json"),
    JSON.stringify({
      version: 1,
      phaseId: "phase-01",
      phaseIndex: 0,
      state: "committed",
      model: "claude-sonnet-4-6",
      effort: "low",
      branchName: "ai/skill-run--phase-01",
      createdAt: now,
      updatedAt: now,
      worktreePath: join(stateRoot, "worktrees", "test-project.skill-run", "phase-01"),
      commitHash: "aabbccdd11223344",
    }),
  );
  await writeFile(join(folder, "phase-handoff.md"), HANDOFF_CONTENT);
}

describe("executePlan — skill edit consent preflight", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-skill-consent-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  function run(
    plan: PhaxPlan,
    layer: ReturnType<typeof makeLayers>["layer"],
    runPath: string,
    runId: RunId,
    startIndex: number,
    allowSkillEdits?: boolean,
  ) {
    return Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# Skill Run",
          config: makeConfig(stateRoot),
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex,
          ...(allowSkillEdits !== undefined ? { allowSkillEdits } : {}),
        }).pipe(Effect.provide(layer)),
      ),
    );
  }

  it("refuses a run without consent before any branch, worktree, or agent work", async () => {
    const plan = makePlan(1);
    const { layer, fakeGit, fakeBackend } = makeLayers();
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Skill Run", plan, makeConfig(stateRoot)).pipe(
        Effect.provide(layer),
      ),
    );

    const result = await run(plan, layer, runPath, runId, 0);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SkillEditConsentError);
      const err = result.left as SkillEditConsentError;
      expect(err.phases).toEqual([{ phaseId: "phase-02", files: [SKILL_FILE] }]);
      expect(err.message).toBe(
        [
          "Security preflight failed: the plan edits skill files, which requires --allow-skill-edits.",
          `  phase-02: ${SKILL_FILE}`,
          "Re-run with --allow-skill-edits to grant exactly these files.",
        ].join("\n"),
      );
    }
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    expect(
      fakeGit.impl.calls.filter((c) => c.method === "createBranch" || c.method === "addWorktree"),
    ).toEqual([]);
  });

  it("proceeds with consent and records it in run-status.json", async () => {
    const plan = makePlan(0);
    const { layer, fakeBackend } = makeLayers();
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Skill Run", plan, makeConfig(stateRoot), undefined, true).pipe(
        Effect.provide(layer),
      ),
    );
    expect(await readRecordedConsent(runPath)).toBe(true);

    const result = await run(plan, layer, runPath, runId, 0, true);

    if (Either.isLeft(result)) expect(result.left).not.toBeInstanceOf(SkillEditConsentError);
    expect(fakeBackend.impl.runCalls.length).toBeGreaterThan(0);
  });

  it("proceeds with consent when no phase declares a skill file", async () => {
    const plan = makePlan(-1);
    const { layer, fakeBackend } = makeLayers();
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Skill Run", plan, makeConfig(stateRoot)).pipe(
        Effect.provide(layer),
      ),
    );

    const result = await run(plan, layer, runPath, runId, 0, true);

    if (Either.isLeft(result)) expect(result.left).not.toBeInstanceOf(SkillEditConsentError);
    expect(fakeBackend.impl.runCalls.length).toBeGreaterThan(0);
  });

  it("resume inherits consent recorded in run-status.json without a flag", async () => {
    const plan = makePlan(1);
    const { layer, fakeBackend } = makeLayers();
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Skill Run", plan, makeConfig(stateRoot), undefined, true).pipe(
        Effect.provide(layer),
      ),
    );
    await markPhase01Committed(stateRoot, runPath);

    const result = await run(plan, layer, runPath, runId, 1, await readRecordedConsent(runPath));

    if (Either.isLeft(result)) expect(result.left).not.toBeInstanceOf(SkillEditConsentError);
    expect(fakeBackend.impl.runCalls.length).toBeGreaterThan(0);
  });

  it("an old run-status.json without the field decodes, and resume is refused", async () => {
    const plan = makePlan(1);
    const { layer, fakeBackend } = makeLayers();
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Skill Run", plan, makeConfig(stateRoot)).pipe(
        Effect.provide(layer),
      ),
    );
    const raw = await readFile(join(runPath, "run-status.json"), "utf8");
    expect(raw).not.toContain("allowSkillEdits");
    await markPhase01Committed(stateRoot, runPath);

    const result = await run(plan, layer, runPath, runId, 1, await readRecordedConsent(runPath));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SkillEditConsentError);
      expect(result.left.message).toContain("phase-02");
    }
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });
});
