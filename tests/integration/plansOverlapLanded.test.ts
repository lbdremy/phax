import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { EXTRACTOR_VERSION, planCacheKey } from "../../src/domain/planCache/key.js";
import { planMdSha256, cacheEntryPath } from "../../src/app/planCacheStore.js";

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

const MODEL = "claude-haiku-4-5-20251001";
const EFFORT = "low";
const NAMESPACE = "test";

function makeBaseConfig(stateRoot: string) {
  return {
    stateRoot,
    namespace: NAMESPACE,
    repoRoot: stateRoot,
    maxFixAttempts: 3,
    extractPlanModel: MODEL,
    extractPlanEffort: EFFORT as const,
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
      project: { name: NAMESPACE, type: "single-package" as const },
      state: { root: stateRoot },
      gateProfiles: {},
      commands: { setup: ["true"] },
    },
  };
}

function makePlanMd(shortName: string): string {
  return [
    `# Plan — ${shortName}`,
    "",
    `## phase-01 — First phase {#phase-01-first}`,
    "",
    "Some content.",
  ].join("\n");
}

async function seedCache(
  stateRoot: string,
  planMdPath: string,
  planMd: string,
  shortName: string,
  creates: string[],
  edits: string[],
): Promise<void> {
  const key = planCacheKey(planMd, MODEL, EFFORT);
  const entry = {
    version: 1,
    key,
    planMdSha256: planMdSha256(planMd),
    model: MODEL,
    effort: EFFORT,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: "2026-01-01T00:00:00.000Z",
    extracted: {
      version: 1,
      run: {
        shortName,
        title: `Plan — ${shortName}`,
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          model: MODEL,
          effort: EFFORT,
          planMarkdownAnchor: "phase-01-first",
          plannedFilesToCreate: creates,
          plannedFilesToEdit: edits,
          optionalFilesToEdit: [],
          commit: { subject: `feat: ${shortName}`, body: "body" },
        },
      ],
    },
  };
  const entryPath = cacheEntryPath(stateRoot, key);
  await mkdir(join(entryPath, ".."), { recursive: true });
  await writeFile(entryPath, JSON.stringify(entry));
}

async function buildFakeRunFolder(
  stateRoot: string,
  shortName: string,
  reconciliation: object,
): Promise<string> {
  const runPath = join(stateRoot, "runs", `${NAMESPACE}.${shortName}`);
  await mkdir(runPath, { recursive: true });

  const now = "2026-06-01T00:00:00.000Z";
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
    }),
  );

  const phaseDir = join(runPath, "phase-01");
  await mkdir(phaseDir, { recursive: true });
  await writeFile(
    join(phaseDir, "status.json"),
    JSON.stringify({
      version: 1,
      phaseId: "phase-01",
      phaseIndex: 0,
      state: "review_open",
      model: MODEL,
      effort: EFFORT,
      branchName: `ai/${shortName}--phase-01`,
      createdAt: now,
      updatedAt: now,
    }),
  );

  await writeFile(join(runPath, "global-file-reconciliation.json"), JSON.stringify(reconciliation));

  return runPath;
}

function makeReconciliation(added: string[], modified: string[], deleted: string[]) {
  const files = [
    ...added.map((path) => ({
      path,
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
    })),
    ...modified.map((path) => ({
      path,
      plannedInPhases: ["phase-01"],
      touchedInPhases: ["phase-01"],
      expectedActions: ["edit"],
      actualActions: ["modified"],
      status: "matched",
      planned: true,
      unplanned: false,
      missing: false,
      extraTouch: false,
      attention: "ok",
    })),
    ...deleted.map((path) => ({
      path,
      plannedInPhases: [],
      touchedInPhases: ["phase-01"],
      expectedActions: [],
      actualActions: ["deleted"],
      status: "deleted",
      planned: false,
      unplanned: true,
      missing: false,
      extraTouch: false,
      attention: "review",
    })),
  ];
  return {
    files,
    unplanned: files.filter((f) => f.unplanned),
    missing: [],
    attentionPoints: files.filter((f) => f.attention === "review"),
  };
}

describe("runPlansOverlap --landed", () => {
  let tmpDir: string;
  let stateRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "phax-plans-overlap-landed-"));
    stateRoot = join(tmpDir, "state");
    await mkdir(join(stateRoot, "runs"), { recursive: true });

    const { loadConfig } = await import("../../src/app/loadConfig.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(loadConfig).mockReturnValue(Either.right(makeBaseConfig(stateRoot) as any));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("landed run with shared source file: exit 0, report lists impacted plan and shared file", async () => {
    const planPath = join(tmpDir, "plan-a.md");
    const md = makePlanMd("plan-a");
    await writeFile(planPath, md);
    await seedCache(stateRoot, planPath, md, "plan-a", [], ["src/shared.ts"]);

    await buildFakeRunFolder(
      stateRoot,
      "landed-run",
      makeReconciliation([], ["src/shared.ts"], []),
    );

    const { runPlansOverlap } = await import("../../src/cli/commands/plansOverlap.js");
    const logs: string[] = [];
    const out = {
      log: (m: string) => logs.push(m),
      error: (m: string) => logs.push(`ERR: ${m}`),
      warn: vi.fn(),
    };

    const exitCode = await runPlansOverlap([planPath], { landed: "landed-run" }, out);

    expect(exitCode).toBe(0);
    const output = logs.join("\n");
    expect(output).toContain("src/shared.ts");
    expect(output).toContain("plan-a");
    expect(output).toMatch(/impacted|re-adjustment/i);
  });

  it("landed run with no shared files: exit 0, plan listed as unaffected", async () => {
    const planPath = join(tmpDir, "plan-b.md");
    const md = makePlanMd("plan-b");
    await writeFile(planPath, md);
    await seedCache(stateRoot, planPath, md, "plan-b", ["src/other.ts"], []);

    await buildFakeRunFolder(
      stateRoot,
      "landed-run",
      makeReconciliation(["src/different.ts"], [], []),
    );

    const { runPlansOverlap } = await import("../../src/cli/commands/plansOverlap.js");
    const logs: string[] = [];
    const out = {
      log: (m: string) => logs.push(m),
      error: (m: string) => logs.push(`ERR: ${m}`),
      warn: vi.fn(),
    };

    const exitCode = await runPlansOverlap([planPath], { landed: "landed-run" }, out);

    expect(exitCode).toBe(0);
    const output = logs.join("\n");
    expect(output).toMatch(/unaffected/i);
  });

  it("run folder lacking a reconciliation file: exit 1 with explanatory message", async () => {
    const runPath = join(stateRoot, "runs", `${NAMESPACE}.empty-run`);
    await mkdir(runPath, { recursive: true });
    const now = "2026-06-01T00:00:00.000Z";
    await writeFile(
      join(runPath, "run-status.json"),
      JSON.stringify({
        version: 1,
        namespace: NAMESPACE,
        shortName: "empty-run",
        runId: "empty-001",
        state: "review_open",
        createdAt: now,
        updatedAt: now,
        phasesCount: 1,
      }),
    );
    const phaseDir = join(runPath, "phase-01");
    await mkdir(phaseDir, { recursive: true });
    await writeFile(
      join(phaseDir, "status.json"),
      JSON.stringify({
        version: 1,
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "review_open",
        model: MODEL,
        effort: EFFORT,
        branchName: "ai/empty-run--phase-01",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const planPath = join(tmpDir, "plan-c.md");
    const md = makePlanMd("plan-c");
    await writeFile(planPath, md);
    await seedCache(stateRoot, planPath, md, "plan-c", ["src/foo.ts"], []);

    const { runPlansOverlap } = await import("../../src/cli/commands/plansOverlap.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m), warn: vi.fn() };

    const exitCode = await runPlansOverlap([planPath], { landed: "empty-run" }, out);

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/reconciliation|review/i);
  });

  it("--json: exit 0 and output parses with impacted/unaffected keys", async () => {
    const planPath = join(tmpDir, "plan-d.md");
    const md = makePlanMd("plan-d");
    await writeFile(planPath, md);
    await seedCache(stateRoot, planPath, md, "plan-d", [], ["src/touched.ts"]);

    await buildFakeRunFolder(
      stateRoot,
      "landed-run",
      makeReconciliation([], ["src/touched.ts"], []),
    );

    const { runPlansOverlap } = await import("../../src/cli/commands/plansOverlap.js");
    const logs: string[] = [];
    const out = { log: (m: string) => logs.push(m), error: vi.fn(), warn: vi.fn() };

    const exitCode = await runPlansOverlap([planPath], { landed: "landed-run", json: true }, out);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(logs.join("")) as unknown;
    expect(parsed).toHaveProperty("impacted");
    expect(parsed).toHaveProperty("unaffected");
    expect(parsed).toHaveProperty("landedLabel");
  });

  it("invalid run name: exit 1 without hitting the filesystem", async () => {
    const planPath = join(tmpDir, "plan-e.md");
    await writeFile(planPath, makePlanMd("plan-e"));

    const { runPlansOverlap } = await import("../../src/cli/commands/plansOverlap.js");
    const errors: string[] = [];
    const out = { log: vi.fn(), error: (m: string) => errors.push(m), warn: vi.fn() };

    const exitCode = await runPlansOverlap([planPath], { landed: "INVALID_NAME" }, out);

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/invalid run name/i);
  });
});
