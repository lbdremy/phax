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
  const runPath = join(stateRoot, "runs", "my-run");
  await mkdir(runPath, { recursive: true });

  await writeFile(
    join(runPath, "run-status.json"),
    JSON.stringify({
      version: 1,
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
        repoRoot: stateRoot,
        editorCommand: "echo",
        maxFixAttempts: 3,
        extractPlanModel: "claude-haiku-4-5-20251001",
        extractPlanEffort: "low" as const,
        fileReconciliationMode: "report_only" as const,

        security: {
          profile: "unsafe",
          filesystem: { allowRead: [], allowWrite: [] },
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
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-02");
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
    expect(lines.some((l) => l.includes("sess-rl"))).toBe(true);
    expect(lines.some((l) => l.includes("phax resume my-run"))).toBe(true);
    expect(lines.some((l) => l.includes("Rate limit exceeded"))).toBe(true);
  });

  it("prints 'not resumable' for a review_open run", async () => {
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
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
    expect(errors.some((e) => e.includes("Invalid short name"))).toBe(true);
  });

  it("returns 1 when run does not exist", async () => {
    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runSessionInfo("no-such-run", out);

    expect(exitCode).toBe(1);
  });
});
