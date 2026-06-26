import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, error: undefined })),
}));

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

const FAKE_SESSION_EXIT_CODE = 0;

function makeBaseConfig(stateRootOverride: string) {
  return {
    stateRoot: stateRootOverride,
    namespace: "test",
    repoRoot: stateRootOverride,
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      profile: "unsafe" as const,
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" as const, allowDomains: [] },
      mcp: { mode: "disabled" as const, allow: [] },
      agentCommands: [],
    },
    publish: {
      enabled: false,
      autoCreatePr: false,
      prTitle: undefined,
      prBody: undefined,
      labels: [],
      reviewers: [],
    },
    complianceReview: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium" as const,
    },
    codeReview: {
      model: "claude-opus-4-8",
      effort: "high" as const,
    },
    raw: {
      version: 1 as const,
      project: { name: "test", type: "single-package" as const },
      state: { root: stateRootOverride },
      gateProfiles: {},
      commands: { setup: ["true"] },
    },
  };
}

async function buildFakeRunFolder(
  stateRoot: string,
  opts: {
    shortName?: string;
    namespace?: string;
    runState?: string;
    phases?: Array<{ id: string; index: number; state: string; worktreePath?: string }>;
  } = {},
): Promise<{ runPath: string; worktreePath: string }> {
  const shortName = opts.shortName ?? "test-run";
  const namespace = opts.namespace ?? "test";
  const runState = opts.runState ?? "review_open";
  const runPath = join(stateRoot, "runs", `${namespace}.${shortName}`);
  const worktreePath = join(stateRoot, "worktrees", shortName, "phase-01");
  const phases = opts.phases ?? [{ id: "phase-01", index: 0, state: "review_open", worktreePath }];

  await mkdir(runPath, { recursive: true });
  await mkdir(worktreePath, { recursive: true });

  const now = "2026-06-26T10:00:00.000Z";
  await writeFile(
    join(runPath, "run-status.json"),
    JSON.stringify({
      version: 1,
      namespace,
      shortName,
      runId: `${shortName}-001`,
      state: runState,
      createdAt: now,
      updatedAt: now,
      phasesCount: phases.length,
      gateProfileId: "full",
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
        branchName: `ai/${shortName}--${phase.id}`,
        createdAt: now,
        updatedAt: now,
        ...(phase.worktreePath ? { worktreePath: phase.worktreePath } : {}),
      }),
    );
  }

  return { runPath, worktreePath };
}

async function writeClaudeBinding(
  phaseDir: string,
  shortName: string,
  worktreePath: string,
  phaseId = "phase-01",
): Promise<void> {
  const now = "2026-06-26T08:00:00.000Z";
  await writeFile(
    join(phaseDir, "agent-binding.json"),
    JSON.stringify({
      version: 1,
      shortName,
      runId: `${shortName}-001`,
      phaseId,
      phaseIndex: 0,
      phaseName: "Test Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      sessionId: "existing-session-111",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: now,
      status: "completed",
    }),
  );
}

async function writeReconciliationMd(runPath: string): Promise<void> {
  await writeFile(
    join(runPath, "global-file-reconciliation.md"),
    "# Reconciliation\n\nAll good.\n",
  );
}

describe("runReviewCode", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-review-code-cmd-"));
    await mkdir(join(stateRoot, "runs"), { recursive: true });

    const { loadConfig } = await import("../../src/app/loadConfig.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(loadConfig).mockReturnValue(Either.right(makeBaseConfig(stateRoot) as any));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("new session: spawns claude --session-id, returns fake exit code", async () => {
    const { spawnSync } = await import("node:child_process");
    const shortName = "test-run";
    const { runPath, worktreePath } = await buildFakeRunFolder(stateRoot, { shortName });
    await writeClaudeBinding(join(runPath, "phase-01"), shortName, worktreePath);
    await writeReconciliationMd(runPath);

    const { runReviewCode } = await import("../../src/cli/commands/reviewCode.js");
    const logs: string[] = [];
    const out = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(`ERR: ${m}`) };

    const exitCode = await runReviewCode(shortName, {}, out);

    expect(exitCode).toBe(FAKE_SESSION_EXIT_CODE);
    expect(spawnSync).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--session-id"]),
      expect.objectContaining({ cwd: worktreePath, stdio: "inherit" }),
    );
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("--model");
    expect(call[1]).toContain("claude-opus-4-8");
    expect(call[1]).toContain("--effort");
    expect(call[1]).toContain("high");
    expect(logs.some((l) => l.toLowerCase().includes("starting"))).toBe(true);
  });

  it("--model/--effort overrides: spawned argv uses overridden values", async () => {
    const { spawnSync } = await import("node:child_process");
    const shortName = "test-run";
    const { runPath, worktreePath } = await buildFakeRunFolder(stateRoot, { shortName });
    await writeClaudeBinding(join(runPath, "phase-01"), shortName, worktreePath);
    await writeReconciliationMd(runPath);

    const { runReviewCode } = await import("../../src/cli/commands/reviewCode.js");
    const out = { log: vi.fn(), error: vi.fn() };

    await runReviewCode(shortName, { model: "claude-sonnet-4-6", effort: "medium" }, out);

    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("claude-sonnet-4-6");
    expect(call[1]).toContain("medium");
    expect(call[1]).not.toContain("claude-opus-4-8");
    expect(call[1]).not.toContain("high");
  });

  it("invalid --effort value: returns 1 without spawning", async () => {
    const { spawnSync } = await import("node:child_process");

    const { runReviewCode } = await import("../../src/cli/commands/reviewCode.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runReviewCode("test-run", { effort: "max" }, out);

    expect(exitCode).toBe(1);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes("low | medium | high"))).toBe(true);
  });

  it("resume (no overrides): spawned argv uses --resume without --model/--effort", async () => {
    const { spawnSync } = await import("node:child_process");
    const shortName = "test-run";
    const { runPath, worktreePath } = await buildFakeRunFolder(stateRoot, { shortName });
    await writeClaudeBinding(join(runPath, "phase-01"), shortName, worktreePath);
    await writeReconciliationMd(runPath);

    // Write an existing session record
    await writeFile(
      join(runPath, "code-review-session.json"),
      JSON.stringify({
        version: 1,
        shortName,
        runId: `${shortName}-001`,
        provider: "claude-code",
        sessionId: "stored-session-abc",
        worktreePath,
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
      }),
    );

    const { runReviewCode } = await import("../../src/cli/commands/reviewCode.js");
    const logs: string[] = [];
    const out = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(`ERR: ${m}`) };

    const exitCode = await runReviewCode(shortName, {}, out);

    expect(exitCode).toBe(FAKE_SESSION_EXIT_CODE);
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("--resume");
    expect(call[1]).toContain("stored-session-abc");
    expect(call[1]).not.toContain("--model");
    expect(call[1]).not.toContain("--effort");
    expect(logs.some((l) => l.toLowerCase().includes("resuming"))).toBe(true);
  });

  it("resume with --model: spawned argv contains --resume plus --model", async () => {
    const { spawnSync } = await import("node:child_process");
    const shortName = "test-run";
    const { runPath, worktreePath } = await buildFakeRunFolder(stateRoot, { shortName });
    await writeClaudeBinding(join(runPath, "phase-01"), shortName, worktreePath);

    await writeFile(
      join(runPath, "code-review-session.json"),
      JSON.stringify({
        version: 1,
        shortName,
        runId: `${shortName}-001`,
        provider: "claude-code",
        sessionId: "stored-session-abc",
        worktreePath,
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
      }),
    );

    const { runReviewCode } = await import("../../src/cli/commands/reviewCode.js");
    const out = { log: vi.fn(), error: vi.fn() };

    await runReviewCode(shortName, { model: "claude-sonnet-4-6" }, out);

    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("--resume");
    expect(call[1]).toContain("stored-session-abc");
    expect(call[1]).toContain("--model");
    expect(call[1]).toContain("claude-sonnet-4-6");
    expect(call[1]).not.toContain("--effort");
  });

  it("run not in review_open: returns 1 without spawning", async () => {
    const { spawnSync } = await import("node:child_process");
    const shortName = "test-run";
    const { runPath, worktreePath } = await buildFakeRunFolder(stateRoot, {
      shortName,
      runState: "running",
    });
    await writeClaudeBinding(join(runPath, "phase-01"), shortName, worktreePath);

    const { runReviewCode } = await import("../../src/cli/commands/reviewCode.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runReviewCode(shortName, {}, out);

    expect(exitCode).toBe(1);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes("review_open"))).toBe(true);
  });
});
