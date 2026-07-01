import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { findCurrentPhase } from "../../src/app/resolveRunInfo.js";
import type { PhaseStatus } from "../../src/schemas/status.js";

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

const now = new Date().toISOString();

async function buildFakeRunFolder(
  stateRoot: string,
  runState: string,
  phases: Array<{
    id: string;
    index: number;
    state: string;
    sessionId?: string;
    worktreePath?: string;
  }>,
  extra: { stoppedReason?: string; lastError?: string } = {},
): Promise<void> {
  const runPath = join(stateRoot, "runs", "test.my-run");
  await mkdir(runPath, { recursive: true });

  await writeFile(
    join(runPath, "run-status.json"),
    JSON.stringify({
      version: 1,
      namespace: "test",
      shortName: "my-run",
      runId: "run-abc",
      state: runState,
      createdAt: now,
      updatedAt: now,
      phasesCount: phases.length,
      gateProfileId: "full",
      ...(extra.stoppedReason ? { stoppedReason: extra.stoppedReason } : {}),
      ...(extra.lastError ? { lastError: extra.lastError } : {}),
    }),
  );

  for (const phase of phases) {
    const phaseDir = join(runPath, phase.id);
    await mkdir(phaseDir, { recursive: true });
    await writeFile(
      join(phaseDir, "status.json"),
      JSON.stringify({
        version: 1,
        phaseId: phase.id,
        phaseIndex: phase.index,
        state: phase.state,
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: `ai/my-run--${phase.id}`,
        createdAt: now,
        updatedAt: now,
        ...(phase.worktreePath ? { worktreePath: phase.worktreePath } : {}),
        ...(phase.sessionId ? { claudeSessionId: phase.sessionId } : {}),
      }),
    );
  }
}

async function writeAgentBindingFile(phaseFolderPath: string, binding: object): Promise<void> {
  await mkdir(phaseFolderPath, { recursive: true });
  await writeFile(join(phaseFolderPath, "agent-binding.json"), JSON.stringify(binding, null, 2));
}

describe("findCurrentPhase", () => {
  it("returns the highest-index non-terminal phase", () => {
    const phases = [
      { phaseId: "phase-01", phaseIndex: 0, state: "cleaned_up" },
      { phaseId: "phase-02", phaseIndex: 1, state: "passed" },
      { phaseId: "phase-03", phaseIndex: 2, state: "rate_limited" },
    ] as PhaseStatus[];

    const result = findCurrentPhase(phases);
    expect(result?.phaseId).toBe("phase-03");
  });

  it("returns undefined when all phases are terminal", () => {
    const phases = [
      { phaseId: "phase-01", state: "cleaned_up" },
      { phaseId: "phase-02", state: "review_open" },
    ] as PhaseStatus[];

    const result = findCurrentPhase(phases);
    expect(result).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(findCurrentPhase([])).toBeUndefined();
  });

  it("treats failed and skipped as terminal", () => {
    const phases = [
      { phaseId: "phase-01", state: "failed" },
      { phaseId: "phase-02", state: "skipped" },
      { phaseId: "phase-03", state: "handoff_failed" },
    ] as PhaseStatus[];

    expect(findCurrentPhase(phases)).toBeUndefined();
  });
});

describe("runSessionInfo", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-sessioninfo-test-"));

    const { loadConfig } = await import("../../src/app/loadConfig.js");
    vi.mocked(loadConfig).mockReturnValue(
      Either.right({
        stateRoot,
        namespace: "test",
        repoRoot: stateRoot,
        maxFixAttempts: 3,
        extractPlanModel: "claude-haiku-4-5-20251001",
        extractPlanEffort: "low" as const,
        fileReconciliationMode: "report_only" as const,

        security: {
          profile: "unsafe",
          filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
          network: { profile: "provider-only", allowDomains: [] },
          mcp: { mode: "disabled", allow: [] },
        },
        raw: {
          version: 1 as const,
          project: { name: "test", type: "single-package" as const },
          state: { root: stateRoot },
          gateProfiles: {},
          commands: { setup: ["true"] },
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("prints run and phase info for a rate_limited run", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-02");
    await buildFakeRunFolder(
      stateRoot,
      "rate_limited",
      [
        { id: "phase-01", index: 0, state: "cleaned_up" },
        { id: "phase-02", index: 1, state: "rate_limited", sessionId: "sess-rl", worktreePath },
      ],
      { stoppedReason: "rate_limited", lastError: "Rate limit exceeded" },
    );

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = {
      log: (m: string) => lines.push(m),
      error: (m: string) => lines.push(`ERR: ${m}`),
    };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("rate_limited"))).toBe(true);
    expect(lines.some((l) => l.includes("phase-02"))).toBe(true);
    expect(lines.some((l) => l.includes("phax resume test.my-run"))).toBe(true);
    expect(lines.some((l) => l.includes("Rate limit exceeded"))).toBe(true);
  });

  it("prints 'not resumable' for a review_open run", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", sessionId: "sess-ro", worktreePath },
    ]);

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = {
      log: (m: string) => lines.push(m),
      error: (m: string) => lines.push(`ERR: ${m}`),
    };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("not resumable"))).toBe(true);
    expect(lines.some((l) => l.includes("review_open"))).toBe(true);
  });

  it("returns 1 for an invalid short name", async () => {
    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runSessionInfo("INVALID NAME", out);

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("not a valid run short name"))).toBe(true);
  });

  it("returns 1 when run does not exist", async () => {
    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runSessionInfo("no-such-run", out);

    expect(exitCode).toBe(1);
  });

  it("shows locked codex binding fields (AC-3)", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const phaseFolderPath = join(stateRoot, "runs", "test.my-run", "phase-01");
    await writeAgentBindingFile(phaseFolderPath, {
      version: 1,
      shortName: "my-run",
      runId: "run-abc",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "My Phase",
      provider: "codex-cli",
      adapter: "codex",
      model: "gpt-4o",
      effort: "high",
      sessionId: "codex-sess-xyz",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "running",
    });

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Provider:") && l.includes("codex-cli"))).toBe(true);
    expect(lines.some((l) => l.includes("Adapter:") && l.includes("codex"))).toBe(true);
    expect(lines.some((l) => l.includes("Model:") && l.includes("gpt-4o"))).toBe(true);
    expect(lines.some((l) => l.includes("Session ID:") && l.includes("codex-sess-xyz"))).toBe(true);
    // codex has no interactive resume: the suggestion must NOT point at enter-phase,
    // even though a session id is present.
    expect(lines.some((l) => l.includes("Suggested enter:") && l.includes("enter-phase"))).toBe(
      false,
    );
  });

  it("shows mistral binding after routing config changes (AC-6 regression)", async () => {
    // Arrange: a phase bound to mistral-vibe
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const phaseFolderPath = join(stateRoot, "runs", "test.my-run", "phase-01");
    await writeAgentBindingFile(phaseFolderPath, {
      version: 1,
      shortName: "my-run",
      runId: "run-abc",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "My Phase",
      provider: "mistral-vibe",
      adapter: "mistral",
      model: "mistral-large",
      effort: "medium",
      sessionId: "vibe-sess-abc",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "running",
    });

    // Even if routing config were changed to prefer claude-code, the binding must win.
    // session-info never consults routing, so no routing mock needed — we just verify output.
    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Provider:") && l.includes("mistral-vibe"))).toBe(true);
    expect(lines.some((l) => l.includes("Adapter:") && l.includes("mistral"))).toBe(true);
    expect(lines.some((l) => l.includes("Model:") && l.includes("mistral-large"))).toBe(true);
    // Must NOT mention claude-code as provider
    expect(lines.every((l) => !l.includes("claude-code"))).toBe(true);
  });

  it("shows a no-binding hint when agent-binding.json is absent", async () => {
    // A phase folder with no agent-binding.json — no legacy inference.
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(
      lines.some((l) => l.includes("Provider:") && l.includes("no agent binding recorded")),
    ).toBe(true);
    expect(lines.some((l) => l.includes("--debug"))).toBe(true);
  });

  it("displays completed binding status", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const phaseFolderPath = join(stateRoot, "runs", "test.my-run", "phase-01");
    await writeAgentBindingFile(phaseFolderPath, {
      version: 1,
      shortName: "my-run",
      runId: "run-abc",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "My Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      sessionId: "sess-done",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "completed",
    });

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Binding status:") && l.includes("completed"))).toBe(true);
  });

  it("displays awaiting_manual_review binding status", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const phaseFolderPath = join(stateRoot, "runs", "test.my-run", "phase-01");
    await writeAgentBindingFile(phaseFolderPath, {
      version: 1,
      shortName: "my-run",
      runId: "run-abc",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "My Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      sessionId: "sess-review",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "awaiting_manual_review",
    });

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(
      lines.some((l) => l.includes("Binding status:") && l.includes("awaiting_manual_review")),
    ).toBe(true);
  });

  it("displays failed binding status", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const phaseFolderPath = join(stateRoot, "runs", "test.my-run", "phase-01");
    await writeAgentBindingFile(phaseFolderPath, {
      version: 1,
      shortName: "my-run",
      runId: "run-abc",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "My Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      sessionId: "sess-fail",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "failed",
    });

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Binding status:") && l.includes("failed"))).toBe(true);
  });

  it("displays archived binding status", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const phaseFolderPath = join(stateRoot, "runs", "test.my-run", "phase-01");
    await writeAgentBindingFile(phaseFolderPath, {
      version: 1,
      shortName: "my-run",
      runId: "run-abc",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "My Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      sessionId: "sess-arc",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "archived",
    });

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out);

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Binding status:") && l.includes("archived"))).toBe(true);
  });

  it("dumps raw metadata with --debug flag", async () => {
    const worktreePath = join(stateRoot, "worktrees", "test.my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, "review_open", [
      { id: "phase-01", index: 0, state: "review_open", worktreePath },
    ]);

    const phaseFolderPath = join(stateRoot, "runs", "test.my-run", "phase-01");
    const bindingObj = {
      version: 1,
      shortName: "my-run",
      runId: "run-abc",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "My Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      sessionId: "claude-sess-001",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "running",
    };
    await writeAgentBindingFile(phaseFolderPath, bindingObj);

    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const lines: string[] = [];
    const out = { log: (m: string) => lines.push(m), error: vi.fn() };

    const exitCode = await runSessionInfo("my-run", out, { debug: true });

    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes("Debug:"))).toBe(true);
    expect(lines.some((l) => l.includes("claude-sess-001"))).toBe(true);
  });
});
