import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { EXTRACTOR_VERSION, planCacheKey } from "../../src/domain/planCache/key.js";
import { planMdSha256, cacheEntryPath } from "../../src/app/planCacheStore.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, error: undefined })),
}));

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

const NAMESPACE = "test";
const SHORT_NAME = "my-feature";
const MODEL = "claude-haiku-4-5-20251001";
const EFFORT = "low" as const;

function makeBaseConfig(stateRoot: string) {
  return {
    stateRoot,
    namespace: NAMESPACE,
    repoRoot: stateRoot,
    maxFixAttempts: 3,
    extractPlanModel: MODEL,
    extractPlanEffort: EFFORT,
    fileReconciliationMode: "report_only" as const,
    security: {
      profile: "unsafe" as const,
      filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
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
      project: { name: NAMESPACE, type: "single-package" as const },
      state: { root: stateRoot },
      gateProfiles: {},
      commands: { setup: ["true"] },
    },
  };
}

async function buildFakeRun(
  stateRoot: string,
  shortName: string,
): Promise<{ runPath: string; phaseDir: string }> {
  const runPath = join(stateRoot, "runs", `${NAMESPACE}.${shortName}`);
  const phaseDir = join(runPath, "phase-01");
  await mkdir(phaseDir, { recursive: true });

  const now = "2026-06-29T10:00:00.000Z";
  await writeFile(
    join(runPath, "run-status.json"),
    JSON.stringify({
      version: 1,
      namespace: NAMESPACE,
      shortName,
      runId: `${shortName}-001`,
      state: "review_open",
      createdAt: now,
      updatedAt: now,
      phasesCount: 1,
      gateProfileId: "full",
    }),
  );
  await writeFile(
    join(phaseDir, "status.json"),
    JSON.stringify({
      version: 1,
      phaseId: "phase-01",
      phaseIndex: 0,
      state: "review_open",
      model: "claude-sonnet-4-6",
      effort: "low",
      branchName: `ai/${shortName}--phase-01`,
      createdAt: now,
      updatedAt: now,
      worktreePath: join(stateRoot, "worktrees", shortName, "phase-01"),
    }),
  );

  return { runPath, phaseDir };
}

async function writeClaudeBinding(phaseDir: string, runPath: string): Promise<void> {
  const now = "2026-06-29T10:00:00.000Z";
  await writeFile(
    join(phaseDir, "agent-binding.json"),
    JSON.stringify({
      version: 1,
      shortName: SHORT_NAME,
      runId: `${SHORT_NAME}-001`,
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "Test Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      sessionId: "existing-session-abc",
      sessionHandle: null,
      worktreePath: join(runPath, "worktrees", "phase-01"),
      cwd: runPath,
      launchedAt: now,
      status: "completed",
    }),
  );
}

async function writeReconciliation(runPath: string): Promise<void> {
  await writeFile(
    join(runPath, "global-file-reconciliation.json"),
    JSON.stringify({
      files: [
        {
          path: "src/domain/foo.ts",
          plannedInPhases: ["phase-01"],
          touchedInPhases: ["phase-01"],
          expectedActions: ["create"],
          actualActions: ["added"],
          status: "matched",
          planned: true,
          unplanned: false,
          missing: false,
          extraTouch: false,
          attention: "ok",
        },
      ],
      unplanned: [],
      missing: [],
      attentionPoints: [],
    }),
  );
}

async function writePlanMd(planPath: string): Promise<string> {
  const content = [
    "# Plan — test-plan",
    "",
    "## phase-01 — First phase {#phase-01-first}",
    "",
    "Some content.",
    "",
    "### Planned files to create",
    "",
    "- src/domain/foo.ts",
  ].join("\n");
  await writeFile(planPath, content);
  return content;
}

async function seedPlanCache(
  stateRoot: string,
  planMdPath: string,
  planMdContent: string,
): Promise<void> {
  const key = planCacheKey(planMdContent, MODEL, EFFORT);
  const entry = {
    version: 1,
    key,
    planMdSha256: planMdSha256(planMdContent),
    model: MODEL,
    effort: EFFORT,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: "2026-06-29T10:00:00.000Z",
    extracted: {
      version: 1,
      run: { shortName: "test-plan", title: "Plan — test-plan", requiredCommands: [] },
      phases: [
        {
          id: "phase-01",
          model: MODEL,
          effort: EFFORT,
          planMarkdownAnchor: "phase-01-first",
          plannedFilesToCreate: ["src/domain/foo.ts"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: test-plan", body: "body" },
        },
      ],
    },
  };
  const entryPath = cacheEntryPath(stateRoot, key);
  await mkdir(join(entryPath, ".."), { recursive: true });
  await writeFile(entryPath, JSON.stringify(entry));
  // Also write the planMd to disk so the cache lookup can verify the hash
  await writeFile(planMdPath, planMdContent);
}

describe("runAdjustPlan", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-adjust-plan-cmd-"));
    await mkdir(join(stateRoot, "runs"), { recursive: true });

    const { loadConfig } = await import("../../src/app/loadConfig.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(loadConfig).mockReturnValue(Either.right(makeBaseConfig(stateRoot) as any));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("new session with cached plan: exit 0, spawns claude --session-id, cwd is process.cwd()", async () => {
    const { spawnSync } = await import("node:child_process");
    const planPath = join(stateRoot, "plan.md");
    const { runPath, phaseDir } = await buildFakeRun(stateRoot, SHORT_NAME);
    await writeClaudeBinding(phaseDir, runPath);
    await writeReconciliation(runPath);
    const planMdContent = await writePlanMd(planPath);
    await seedPlanCache(stateRoot, planPath, planMdContent);

    const { runAdjustPlan } = await import("../../src/cli/commands/adjustPlan.js");
    const logs: string[] = [];
    const out = {
      log: (m: string) => logs.push(m),
      error: (m: string) => logs.push(`ERR: ${m}`),
      warn: (m: string) => logs.push(`WARN: ${m}`),
    };

    const exitCode = await runAdjustPlan(planPath, { landed: SHORT_NAME }, out);

    expect(exitCode).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--session-id"]),
      expect.objectContaining({ cwd: process.cwd(), stdio: "inherit" }),
    );
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("--model");
    expect(call[1]).toContain("claude-opus-4-8");
    expect(call[1]).toContain("--effort");
    expect(call[1]).toContain("high");
    expect(logs.some((l) => l.toLowerCase().includes("starting"))).toBe(true);
  });

  it("resume (no --new-session): spawns --resume with existing session id", async () => {
    const { spawnSync } = await import("node:child_process");
    const planPath = join(stateRoot, "plan.md");
    const { runPath, phaseDir } = await buildFakeRun(stateRoot, SHORT_NAME);
    await writeClaudeBinding(phaseDir, runPath);
    await writeReconciliation(runPath);
    await writePlanMd(planPath);

    // Write an existing session record
    const planSlug = planPath
      .replace(/[^a-zA-Z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const sessionDir = join(runPath, "adjust-plan-sessions", planSlug);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        version: 1,
        planPath,
        landedRunKey: `${NAMESPACE}.${SHORT_NAME}`,
        provider: "claude-code",
        sessionId: "resume-session-xyz",
        cwd: process.cwd(),
        createdAt: "2026-06-28T10:00:00.000Z",
        updatedAt: "2026-06-28T10:00:00.000Z",
      }),
    );

    const { runAdjustPlan } = await import("../../src/cli/commands/adjustPlan.js");
    const logs: string[] = [];
    const out = {
      log: (m: string) => logs.push(m),
      error: (m: string) => logs.push(`ERR: ${m}`),
      warn: (m: string) => logs.push(`WARN: ${m}`),
    };

    const exitCode = await runAdjustPlan(planPath, { landed: SHORT_NAME }, out);

    expect(exitCode).toBe(0);
    const call = vi.mocked(spawnSync).mock.calls[0]!;
    expect(call[1]).toContain("--resume");
    expect(call[1]).toContain("resume-session-xyz");
    expect(call[1]).not.toContain("--model");
    expect(call[1]).not.toContain("--effort");
    expect(logs.some((l) => l.toLowerCase().includes("resuming"))).toBe(true);
  });

  it("landed run lacking reconciliation: exit 1, refused error", async () => {
    const { spawnSync } = await import("node:child_process");
    const planPath = join(stateRoot, "plan.md");
    const { phaseDir, runPath } = await buildFakeRun(stateRoot, SHORT_NAME);
    await writeClaudeBinding(phaseDir, runPath);
    // No reconciliation written
    await writePlanMd(planPath);

    const { runAdjustPlan } = await import("../../src/cli/commands/adjustPlan.js");
    const errors: string[] = [];
    const out = {
      log: vi.fn(),
      error: (m: string) => errors.push(m),
      warn: vi.fn(),
    };

    const exitCode = await runAdjustPlan(planPath, { landed: SHORT_NAME, newSession: true }, out);

    expect(exitCode).toBe(1);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes("global-file-reconciliation.json"))).toBe(true);
  });

  it("invalid --effort: exit 1 without spawning", async () => {
    const { spawnSync } = await import("node:child_process");

    const { runAdjustPlan } = await import("../../src/cli/commands/adjustPlan.js");
    const errors: string[] = [];
    const out = {
      log: vi.fn(),
      error: (m: string) => errors.push(m),
      warn: vi.fn(),
    };

    const exitCode = await runAdjustPlan("plan.md", { landed: SHORT_NAME, effort: "max" }, out);

    expect(exitCode).toBe(1);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes("low | medium | high"))).toBe(true);
  });

  it("missing plan.md: exit 1 without spawning", async () => {
    const { spawnSync } = await import("node:child_process");
    const { phaseDir, runPath } = await buildFakeRun(stateRoot, SHORT_NAME);
    await writeClaudeBinding(phaseDir, runPath);

    const { runAdjustPlan } = await import("../../src/cli/commands/adjustPlan.js");
    const errors: string[] = [];
    const out = {
      log: vi.fn(),
      error: (m: string) => errors.push(m),
      warn: vi.fn(),
    };

    const exitCode = await runAdjustPlan(
      join(stateRoot, "nonexistent.md"),
      { landed: SHORT_NAME },
      out,
    );

    expect(exitCode).toBe(1);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes("nonexistent.md"))).toBe(true);
  });
});
