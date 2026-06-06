import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { decodeShortName } from "../../src/domain/branded.js";
import { resolvePhaseInfo } from "../../src/app/resolveRunInfo.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, error: undefined })),
}));

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

const now = new Date().toISOString();
const SHORT_NAME = Either.getOrThrow(decodeShortName("my-run"));

async function buildFakeRunFolder(
  stateRoot: string,
  phases: Array<{
    id: string;
    index: number;
    state: string;
    sessionId?: string;
    worktreePath?: string;
  }>,
  runState = "rate_limited",
): Promise<string> {
  const runPath = join(stateRoot, "runs", "my-run");
  await mkdir(runPath, { recursive: true });

  await writeFile(
    join(runPath, "run-status.json"),
    JSON.stringify({
      version: 1,
      shortName: "my-run",
      runId: "run-123",
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
        branchName: `ai/my-run--${phase.id}`,
        createdAt: now,
        updatedAt: now,
        ...(phase.worktreePath ? { worktreePath: phase.worktreePath } : {}),
        ...(phase.sessionId ? { claudeSessionId: phase.sessionId } : {}),
      }),
    );
  }

  return runPath;
}

describe("resolvePhaseInfo", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-enterphase-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("returns the correct PhaseStatus for the requested phase", async () => {
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    await buildFakeRunFolder(stateRoot, [
      {
        id: "phase-01",
        index: 0,
        state: "rate_limited",
        sessionId: "sess-abc",
        worktreePath,
      },
      {
        id: "phase-02",
        index: 1,
        state: "pending",
      },
    ]);

    const result = resolvePhaseInfo(SHORT_NAME, "phase-01", stateRoot);
    expect(Either.isRight(result)).toBe(true);
    const info = Either.getOrThrow(result);
    expect(info.phaseStatus.phaseId).toBe("phase-01");
    expect(info.phaseStatus.state).toBe("rate_limited");
    expect(info.phaseStatus.claudeSessionId).toBe("sess-abc");
    expect(info.phaseStatus.worktreePath).toBe(worktreePath);
    expect(info.runState).toBe("rate_limited");
    expect(info.shortName).toBe("my-run");
  });

  it("returns Left when phaseId does not exist", async () => {
    await buildFakeRunFolder(stateRoot, [{ id: "phase-01", index: 0, state: "committed" }]);

    const result = resolvePhaseInfo(SHORT_NAME, "phase-99", stateRoot);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("phase-99");
    }
  });

  it("returns Left when run folder does not exist", async () => {
    const result = resolvePhaseInfo(SHORT_NAME, "phase-01", stateRoot);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("runEnterPhase", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-enterphase-test-"));

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

  it("spawns claude --resume with the correct session and worktree", async () => {
    const { spawnSync } = await import("node:child_process");
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    await buildFakeRunFolder(stateRoot, [
      {
        id: "phase-01",
        index: 0,
        state: "rate_limited",
        sessionId: "sess-xyz",
        worktreePath,
      },
    ]);

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const logs: string[] = [];
    const out = { log: (m: string) => logs.push(m), error: (m: string) => logs.push(`ERR: ${m}`) };

    const exitCode = await runEnterPhase("my-run", "phase-01", out);

    expect(exitCode).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith("claude", ["--resume", "sess-xyz"], {
      cwd: worktreePath,
      stdio: "inherit",
    });
  });

  it("returns 1 with an error when phase has no session id", async () => {
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    await buildFakeRunFolder(stateRoot, [
      {
        id: "phase-01",
        index: 0,
        state: "setting_up_worktree",
        worktreePath,
      },
    ]);

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runEnterPhase("my-run", "phase-01", out);

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("No Claude session ID"))).toBe(true);
  });

  it("returns 1 with an error when phase does not exist", async () => {
    await buildFakeRunFolder(stateRoot, [{ id: "phase-01", index: 0, state: "committed" }]);

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runEnterPhase("my-run", "phase-99", out);

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("phase-99"))).toBe(true);
  });
});
