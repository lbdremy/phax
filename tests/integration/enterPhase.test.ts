import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { decodeShortName } from "../../src/domain/branded.js";
import { resolvePhaseInfo } from "../../src/app/resolveRunInfo.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import type { PhaseStatus } from "../../src/schemas/status.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, error: undefined })),
}));

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

// No test reads ~/.phax: providers.json is the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const { Effect } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG } = await import("../../src/domain/routing/defaults.js");
  return { ...original, loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG) };
});

const now = new Date().toISOString();
const SHORT_NAME = Either.getOrThrow(decodeShortName("my-run"));

async function buildFakeRunFolder(
  stateRoot: string,
  phases: Array<{
    id: string;
    index: number;
    state: PhaseStatus["state"];
    sessionId?: string;
    worktreePath?: string;
  }>,
  runState = "rate_limited",
): Promise<string> {
  const runPath = join(stateRoot, "runs", "test.my-run");
  await mkdir(runPath, { recursive: true });

  await writeFile(
    join(runPath, "run-status.json"),
    JSON.stringify({
      version: 1,
      namespace: "test",
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
      JSON.stringify(
        phaseStatusFile({
          phaseId: phase.id,
          phaseIndex: phase.index,
          state: phase.state,
          model: "claude-sonnet-4-6",
          effort: "low",
          branchName: `ai/my-run--${phase.id}`,
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          createdAt: now,
          updatedAt: now,
          ...(phase.worktreePath ? { worktreePath: phase.worktreePath } : {}),
          ...(phase.sessionId ? { claudeSessionId: phase.sessionId } : {}),
        }),
      ),
    );
  }

  return runPath;
}

async function writeAgentBindingFixture(
  phaseDir: string,
  opts: {
    provider: string;
    adapter: string;
    sessionId: string | null;
    worktreePath: string;
  },
): Promise<void> {
  await writeFile(
    join(phaseDir, "agent-binding.json"),
    JSON.stringify({
      version: 1,
      shortName: "my-run",
      runId: "run-123",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "Test Phase",
      provider: opts.provider,
      adapter: opts.adapter,
      model: "claude-sonnet-4-6",
      effort: "low",
      sessionId: opts.sessionId,
      sessionHandle: null,
      worktreePath: opts.worktreePath,
      cwd: opts.worktreePath,
      launchedAt: now,
      status: "running",
    }),
  );
}

// The posture a phase recorded in security.json: what a re-entered session carries.
async function writeSecurityFixture(
  phaseDir: string,
  provider: string,
  worktreePath: string,
): Promise<void> {
  await writeFile(
    join(phaseDir, "security.json"),
    JSON.stringify({
      version: 1,
      mode: "secure",
      provider,
      sandboxEnabled: true,
      filesystem: { allowRead: [worktreePath], allowWrite: [worktreePath] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      downgraded: false,
      marks: [],
      agentCommands: [],
      skillEditGrants: [],
      providerSkippedForSecurity: [],
    }),
  );
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

    const result = resolvePhaseInfo("test", SHORT_NAME, "phase-01", stateRoot);
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

    const result = resolvePhaseInfo("test", SHORT_NAME, "phase-99", stateRoot);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("phase-99");
    }
  });

  it("returns Left when run folder does not exist", async () => {
    const result = resolvePhaseInfo("test", SHORT_NAME, "phase-01", stateRoot);
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
        namespace: "test",
        repoRoot: stateRoot,
        maxFixAttempts: 3,
        extractPlanModel: "claude-haiku-4-5-20251001",
        extractPlanEffort: "low",
        fileReconciliationMode: "report_only",
        security: {
          profile: "unsafe",
          filesystem: { allowRead: [], allowWrite: [] },
          network: { profile: "provider-only" },
          mcp: { mode: "disabled", allow: [] },
          agentCommands: [],
        },
        publish: {
          auto: false,
          remote: "origin",
          provider: "github",
          pushBranch: true,
          createPullRequest: true,
        },
        complianceReview: { enabled: false, model: "claude-sonnet-5", effort: "medium" },
        codeReview: { model: "claude-opus-5-5", effort: "high" },
        authoring: {
          spec: { model: "claude-opus-5-5", effort: "high" },
          plan: { model: "claude-opus-5-5", effort: "high" },
        },
        records: {
          enabled: false,
          transcript: false,
          destination: { kind: "in-repo" },
          autoPush: false,
        },
        raw: {
          version: 1,
          name: "test",
          state: { root: stateRoot },
          gateProfiles: {},
          commands: { setup: ["true"] },
        },
      } satisfies ResolvedConfig),
    );
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("dispatches to claude adapter and spawns --resume when binding is claude", async () => {
    const { spawnSync } = await import("node:child_process");
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const runPath = await buildFakeRunFolder(stateRoot, [
      { id: "phase-01", index: 0, state: "rate_limited", sessionId: "sess-xyz", worktreePath },
    ]);
    const phaseDir = join(runPath, "phase-01");
    await writeAgentBindingFixture(phaseDir, {
      provider: "claude-code",
      adapter: "claude",
      sessionId: "sess-xyz",
      worktreePath,
    });
    await writeSecurityFixture(phaseDir, "claude-code", worktreePath);

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const logs: string[] = [];
    const out = {
      log: (m: string) => logs.push(m),
      warn: (m: string) => logs.push(`WARN: ${m}`),
      error: (m: string) => logs.push(`ERR: ${m}`),
    };

    const exitCode = await runEnterPhase("my-run", "phase-01", out);

    expect(exitCode).toBe(0);
    // The session is resumed under the phase's own posture (carry-posture).
    expect(spawnSync).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--resume", "sess-xyz", "--permission-mode", "acceptEdits"]),
      { cwd: worktreePath, stdio: "inherit" },
    );
    const args = vi.mocked(spawnSync).mock.calls[0]![1] as string[];
    expect(args.slice(0, 6)).toEqual([
      "--resume",
      "sess-xyz",
      "--model",
      "claude-sonnet-4-6",
      "--effort",
      "low",
    ]);
  });

  it("resumes a codex binding interactively with codex resume, under the phase's posture", async () => {
    const { spawnSync } = await import("node:child_process");
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const runPath = await buildFakeRunFolder(stateRoot, [
      { id: "phase-01", index: 0, state: "rate_limited", worktreePath },
    ]);
    const phaseDir = join(runPath, "phase-01");
    await writeAgentBindingFixture(phaseDir, {
      provider: "codex-cli",
      adapter: "codex",
      sessionId: "sess-codex",
      worktreePath,
    });
    await writeSecurityFixture(phaseDir, "codex-cli", worktreePath);

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const output = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const exitCode = await runEnterPhase("my-run", "phase-01", output);

    expect(exitCode).toBe(0);
    expect(output.error).not.toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", "sess-codex", 'approval_policy="on-request"']),
      { cwd: worktreePath, stdio: "inherit" },
    );
  });

  it("refuses to re-enter a phase whose security.json is missing, opening nothing", async () => {
    const { spawnSync } = await import("node:child_process");
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const runPath = await buildFakeRunFolder(stateRoot, [
      { id: "phase-01", index: 0, state: "rate_limited", sessionId: "sess-xyz", worktreePath },
    ]);
    await writeAgentBindingFixture(join(runPath, "phase-01"), {
      provider: "claude-code",
      adapter: "claude",
      sessionId: "sess-xyz",
      worktreePath,
    });

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), warn: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runEnterPhase("my-run", "phase-01", out);

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("security.json");
    expect(errors.join("\n")).toContain("will not open its session unconfined");
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("returns 1 with a no-binding error when agent-binding.json is absent", async () => {
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    await buildFakeRunFolder(stateRoot, [
      { id: "phase-01", index: 0, state: "rate_limited", sessionId: "sess-xyz", worktreePath },
    ]);
    // No agent-binding.json — binding is required, no legacy inference.

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), warn: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runEnterPhase("my-run", "phase-01", out);

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("No agent binding found"))).toBe(true);
  });

  it("returns 1 with an error when phase does not exist", async () => {
    await buildFakeRunFolder(stateRoot, [{ id: "phase-01", index: 0, state: "committed" }]);

    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), warn: vi.fn(), error: (m: string) => errors.push(m) };

    const exitCode = await runEnterPhase("my-run", "phase-99", out);

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("phase-99"))).toBe(true);
  });
});
