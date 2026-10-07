import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareCodeReviewSession } from "../../src/app/reviewCode.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { ResolvedCodeReviewConfig } from "../../src/schemas/phaxConfig.js";
import { encodePhaseAgentBinding } from "../../src/schemas/phaseAgentBinding.js";
import { encodeCodeReviewSession } from "../../src/schemas/codeReviewSession.js";
import { CODE_REVIEW_PROMPT_FILENAME } from "../../src/domain/review/codeReviewPrompt.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const worktreePath = "/fake/worktrees/test-run--phase-02";
const phaxContextPath = `${worktreePath}/.phax-context`;
const finalPhaseId = "phase-02";
const finalPhaseFolder = `${runPath}/${finalPhaseId}`;
const bindingPath = `${finalPhaseFolder}/agent-binding.json`;
const sessionRecordPath = `${runPath}/code-review-session.json`;
const promptFilePath = `${phaxContextPath}/${CODE_REVIEW_PROMPT_FILENAME}`;
const nowIso = "2026-06-26T10:00:00.000Z";

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName,
    runId: "test-run-999",
    runState: "review_open",
    branch: "feature/test-run",
    runTitle: "My Run Title",
    finalPhaseBranch: "feature/test-run--phase-02" as BranchName,
    stateRoot,
    runPath,
    finalPhaseId,
    finalPhaseTitle: "Final Phase",
    worktreePath,
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [
      { id: "phase-01", title: "First Phase" },
      { id: "phase-02", title: "Final Phase" },
    ],
    updatedAt: "2026-06-26T09:00:00.000Z",
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

const defaultConfig: ResolvedCodeReviewConfig = {
  model: "claude-opus-4-8",
  effort: "high",
};

const claudeBinding = encodePhaseAgentBinding({
  version: 1,
  shortName,
  runId: "test-run-999",
  phaseId: finalPhaseId,
  phaseIndex: 1,
  phaseName: "Final Phase",
  provider: "claude-code",
  adapter: "claude",
  model: "claude-sonnet-4-6",
  effort: "medium",
  sessionId: "existing-session-111",
  sessionHandle: null,
  worktreePath,
  cwd: worktreePath,
  launchedAt: "2026-06-26T08:00:00.000Z",
  status: "completed",
});

const codexBinding = encodePhaseAgentBinding({
  version: 1,
  shortName,
  runId: "test-run-999",
  phaseId: finalPhaseId,
  phaseIndex: 1,
  phaseName: "Final Phase",
  provider: "codex-cli",
  adapter: "codex",
  model: "codex-mini",
  effort: "medium",
  sessionId: null,
  sessionHandle: null,
  worktreePath,
  cwd: worktreePath,
  launchedAt: "2026-06-26T08:00:00.000Z",
  status: "completed",
});

function reconciliationEntry(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    path: "src/x.ts",
    plannedInPhases: [],
    touchedInPhases: [],
    optionalInPhases: [],
    expectedActions: [],
    actualActions: [],
    status: "unplanned",
    planned: false,
    unplanned: true,
    missing: false,
    extraTouch: false,
    attention: "review",
    ...overrides,
  };
}

const attentionPathA = "src/unplanned-a.ts";
const attentionPathB = "src/missing-b.ts";

const validReconciliationJson = JSON.stringify({
  files: [],
  unplanned: [],
  missing: [],
  attentionPoints: [
    reconciliationEntry({
      path: attentionPathA,
      status: "unplanned",
      touchedInPhases: ["phase-01"],
    }),
    reconciliationEntry({
      path: attentionPathB,
      status: "missing",
      plannedInPhases: ["phase-02"],
    }),
  ],
});

const reconciliationJsonPath = `${runPath}/global-file-reconciliation.json`;
const NO_ATTENTION_SENTINEL = "_No attention points recorded._";

const validComplianceJson = JSON.stringify({
  version: 1,
  verdict: "conformant-with-deviations",
  summary: "Mostly good.",
  perPhase: [
    {
      phaseId: "phase-01",
      verdict: "conformant-with-deviations",
      findings: [{ dimension: "files", severity: "deviation", message: "Extra file added" }],
    },
  ],
  attentionPoints: ["Review the extra file in phase-01"],
  pointers: ["Possible bug at src/foo.ts line 42"],
});

function makeLayer(fs: ReturnType<typeof makeFakeFileSystem>) {
  return Layer.mergeAll(fs.layer, NoopSystemTelemetryLayer);
}

describe("prepareCodeReviewSession", () => {
  it("new session: writes prompt and session record, returns mode 'new' with claude --session-id", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));
    fs.impl.setFile(reconciliationJsonPath, validReconciliationJson);

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("new");

    // Claude argv: --session-id <id> --model <m> --effort <e> <prompt>
    expect(result.invocation.executable).toBe("claude");
    expect(result.invocation.args[0]).toBe("--session-id");
    expect(result.invocation.args).toContain("--model");
    expect(result.invocation.args).toContain("claude-opus-4-8");
    expect(result.invocation.args).toContain("--effort");
    expect(result.invocation.args).toContain("high");
    expect(result.invocation.cwd).toBe(worktreePath);

    // Prompt file written in worktree
    const promptContent = fs.impl.getFile(promptFilePath);
    expect(promptContent).toBeDefined();
    expect(promptContent).toContain("Code review session");

    // Worklist sourced from the reconciliation JSON — both attention points
    // rendered, empty-worklist sentinel absent
    expect(promptContent).toContain(attentionPathA);
    expect(promptContent).toContain(attentionPathB);
    expect(promptContent).not.toContain(NO_ATTENTION_SENTINEL);

    // Session record written
    const recordRaw = fs.impl.getFile(sessionRecordPath);
    expect(recordRaw).toBeDefined();
    const record = JSON.parse(recordRaw!);
    expect(record.version).toBe(1);
    expect(record.shortName).toBe(shortName);
    expect(record.provider).toBe("claude-code");
    expect(record.createdAt).toBe(nowIso);
    expect(record.updatedAt).toBe(nowIso);
    expect(typeof record.sessionId).toBe("string");
    expect(record.sessionId.length).toBeGreaterThan(0);
  });

  // validComplianceJson is in the pre-schema shape (version 1, no $schema): a
  // review written by 0.16.0 still feeds the prompt.
  it("new session with compliance present: prompt reflects compliance content", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));
    fs.impl.setFile(reconciliationJsonPath, validReconciliationJson);
    fs.impl.setFile(`${runPath}/compliance-review.json`, validComplianceJson);

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("new");

    const promptContent = fs.impl.getFile(promptFilePath);
    expect(promptContent).toBeDefined();
    expect(promptContent).toContain("Review the extra file in phase-01");
    expect(promptContent).toContain("Possible bug at src/foo.ts line 42");
    expect(promptContent).toContain("Extra file added");
    // Should NOT have the compliance-missing note
    expect(promptContent).not.toContain("phax review-compliance");
  });

  it("new session with a compliance review phax wrote with $schema: prompt reflects it", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));
    fs.impl.setFile(reconciliationJsonPath, validReconciliationJson);
    const { version: _version, ...review } = JSON.parse(validComplianceJson) as Record<
      string,
      unknown
    >;
    fs.impl.setFile(
      `${runPath}/compliance-review.json`,
      JSON.stringify({ $schema: schemaUrl("compliance-review", PHAX_RELEASE), ...review }),
    );

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    const promptContent = fs.impl.getFile(promptFilePath);
    expect(promptContent).toContain("Review the extra file in phase-01");
    expect(promptContent).toContain("Extra file added");
    expect(promptContent).not.toContain("phax review-compliance");
  });

  it("new session without compliance: prompt includes compliance-missing tip", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));
    fs.impl.setFile(reconciliationJsonPath, validReconciliationJson);
    // No compliance-review.json

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    const promptContent = fs.impl.getFile(promptFilePath);
    expect(promptContent).toContain("phax review-compliance");
  });

  it("new session with no reconciliation JSON: ready with empty worklist", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));
    // No global-file-reconciliation.json

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    const promptContent = fs.impl.getFile(promptFilePath);
    expect(promptContent).toContain(NO_ATTENTION_SENTINEL);
  });

  it("new session with malformed reconciliation JSON: ready with empty worklist", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));
    fs.impl.setFile(reconciliationJsonPath, "{ not valid json");

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    const promptContent = fs.impl.getFile(promptFilePath);
    expect(promptContent).toContain(NO_ATTENTION_SENTINEL);
  });

  it("resume (no overrides): returns mode 'resume' with --resume, no --model/--effort", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));

    const existingRecord = encodeCodeReviewSession({
      version: 1,
      shortName,
      runId: "test-run-999",
      provider: "claude-code",
      sessionId: "stored-session-abc",
      worktreePath,
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
    });
    fs.impl.setFile(sessionRecordPath, JSON.stringify(existingRecord));

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("resume");

    // Claude argv: --resume <id> with no --model/--effort
    expect(result.invocation.args[0]).toBe("--resume");
    expect(result.invocation.args[1]).toBe("stored-session-abc");
    expect(result.invocation.args).not.toContain("--model");
    expect(result.invocation.args).not.toContain("--effort");
    expect(result.invocation.args.length).toBe(2);

    // updatedAt refreshed in the persisted record
    const updatedRaw = fs.impl.getFile(sessionRecordPath);
    const updated = JSON.parse(updatedRaw!);
    expect(updated.updatedAt).toBe(nowIso);
    expect(updated.createdAt).toBe("2026-06-25T10:00:00.000Z");
    expect(updated.sessionId).toBe("stored-session-abc");
  });

  it("resume with modelOverride: argv contains --model after --resume", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));

    const existingRecord = encodeCodeReviewSession({
      version: 1,
      shortName,
      runId: "test-run-999",
      provider: "claude-code",
      sessionId: "stored-session-abc",
      worktreePath,
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
    });
    fs.impl.setFile(sessionRecordPath, JSON.stringify(existingRecord));

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
        modelOverride: "claude-sonnet-4-6",
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("resume");

    expect(result.invocation.args[0]).toBe("--resume");
    expect(result.invocation.args[1]).toBe("stored-session-abc");
    expect(result.invocation.args).toContain("--model");
    expect(result.invocation.args).toContain("claude-sonnet-4-6");
    expect(result.invocation.args).not.toContain("--effort");
  });

  it("newSession: true with existing record: regenerates and returns mode 'new'", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(claudeBinding));
    fs.impl.setFile(reconciliationJsonPath, validReconciliationJson);

    const existingRecord = encodeCodeReviewSession({
      version: 1,
      shortName,
      runId: "test-run-999",
      provider: "claude-code",
      sessionId: "old-session-xyz",
      worktreePath,
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
    });
    fs.impl.setFile(sessionRecordPath, JSON.stringify(existingRecord));

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: true,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.mode).toBe("new");

    // New session id should be different
    expect(result.invocation.args[0]).toBe("--session-id");
    expect(result.invocation.args[1]).not.toBe("old-session-xyz");

    // Session record overwritten
    const updatedRaw = fs.impl.getFile(sessionRecordPath);
    const updated = JSON.parse(updatedRaw!);
    expect(updated.sessionId).not.toBe("old-session-xyz");
    expect(updated.createdAt).toBe(nowIso);
  });

  it("unsupported provider for new session: returns kind 'unsupported', no session record", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(bindingPath, JSON.stringify(codexBinding));
    fs.impl.setFile(reconciliationJsonPath, validReconciliationJson);

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.message).toMatch(/codex-cli/i);
    expect(result.message).toMatch(/does not support/i);

    // No session record persisted
    expect(fs.impl.getFile(sessionRecordPath)).toBeUndefined();
    // No prompt file leaked to the worktree on the unsupported path
    expect(fs.impl.getFile(promptFilePath)).toBeUndefined();
  });

  it("missing agent binding: returns kind 'refused'", async () => {
    const fs = makeFakeFileSystem();
    // No binding file

    const result = await Effect.runPromise(
      prepareCodeReviewSession(makeInfo(), defaultConfig, {
        newSession: false,
        nowIso,
      }).pipe(Effect.provide(makeLayer(fs))),
    );

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.message).toMatch(/agent binding/i);
    expect(result.message).toContain(shortName);
  });
});

// A run directory written before phax wrote `$schema`: its phax-plan.json
// (version 1) still gives run info the branch, the title and the phases the
// review uses. Every document here is made up.
function legacyPlanPhase(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    model: "example-model",
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    commit: { subject: `feat: ${id}`, body: "Example body." },
  };
}

describe("review info from a phax-plan.json written before $schema", () => {
  let legacyStateRoot: string;

  beforeEach(() => {
    legacyStateRoot = mkdtempSync(join(tmpdir(), "phax-legacy-review-"));
    const legacyRunPath = join(legacyStateRoot, "runs", "example.example-run");
    mkdirSync(join(legacyRunPath, "phase-02"), { recursive: true });
    const write = (path: string, doc: unknown) =>
      writeFileSync(join(legacyRunPath, path), JSON.stringify(doc, null, 2));
    write("run-status.json", {
      version: 1,
      namespace: "example",
      shortName: "example-run",
      runId: "run-0001",
      state: "review_open",
      createdAt: nowIso,
      updatedAt: nowIso,
      phasesCount: 2,
    });
    // A phase status written before $schema never noted its branch's base and
    // is refused, so the phase status here is a current one.
    write("phase-02/status.json", {
      $schema: schemaUrl("phase-status", PHAX_RELEASE),
      phaseId: "phase-02",
      phaseIndex: 1,
      state: "review_open",
      model: "example-model",
      effort: "medium",
      createdAt: nowIso,
      updatedAt: nowIso,
      branchName: "phax/example-run--phase-02",
      base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      worktreePath: "/work/example-repo/worktrees/phase-02",
    });
    write("phax-plan.json", {
      version: 1,
      run: {
        shortName: "example-run",
        title: "Example Run",
        branch: "phax/example-run",
        requiredCommands: [],
      },
      phases: [legacyPlanPhase("phase-01", "First"), legacyPlanPhase("phase-02", "Second")],
    });
  });

  afterEach(() => {
    rmSync(legacyStateRoot, { recursive: true, force: true });
  });

  it("loads the plan's branch, title and phases", () => {
    const shortNameValue = Either.getOrThrow(decodeShortName("example-run"));
    const result = resolveRun("example", shortNameValue, legacyStateRoot);
    if (Either.isLeft(result)) throw new Error(result.left);
    expect(result.right.branch).toBe("phax/example-run");
    expect(result.right.runTitle).toBe("Example Run");
    expect(result.right.planPhases).toEqual([
      { id: "phase-01", title: "First" },
      { id: "phase-02", title: "Second" },
    ]);
  });
});
