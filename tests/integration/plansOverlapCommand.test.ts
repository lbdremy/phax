import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { EXTRACTOR_VERSION, planCacheKey } from "../../src/domain/planCache/key.js";
import { planMdSha256, cacheEntryPath } from "../../src/app/planCacheStore.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { phaxCall } from "../helpers/runnerCall.js";

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

const MODEL = "claude-haiku-4-5-20251001";
const EFFORT = "low";

function makeBaseConfig(stateRoot: string): ResolvedConfig {
  return {
    stateRoot,
    namespace: "test",
    repoRoot: stateRoot,
    maxFixAttempts: 3,
    extractPlanModel: MODEL,
    extractPlanEffort: EFFORT,
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
    complianceReview: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium",
    },
    codeReview: {
      enabled: false,
      model: "claude-opus-4-8",
      effort: "high",
    },
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
          mode: "headless",
          acceptance: null,
          testLines: [],
          commit: { subject: `feat: ${shortName}`, body: "body" },
        },
      ],
    },
  };
  const entryPath = cacheEntryPath(stateRoot, key);
  await mkdir(join(entryPath, ".."), { recursive: true });
  await writeFile(entryPath, JSON.stringify(entry));
}

describe("runPlansOverlap", () => {
  let tmpDir: string;
  let stateRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "phax-plans-overlap-cmd-"));
    stateRoot = join(tmpDir, "state");
    await mkdir(stateRoot, { recursive: true });

    const { loadConfig } = await import("../../src/app/loadConfig.js");
    vi.mocked(loadConfig).mockReturnValue(Either.right(makeBaseConfig(stateRoot)));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("two disjoint plans: exit 0, report names both plans and parallel-safe set", async () => {
    const planAPath = join(tmpDir, "a.md");
    const planBPath = join(tmpDir, "b.md");
    const mdA = makePlanMd("plan-a");
    const mdB = makePlanMd("plan-b");
    await writeFile(planAPath, mdA);
    await writeFile(planBPath, mdB);
    await seedCache(stateRoot, mdA, "plan-a", ["src/foo.ts"], []);
    await seedCache(stateRoot, mdB, "plan-b", ["src/bar.ts"], []);

    const { code: exitCode, out: output } = await phaxCall([
      "plans",
      "overlap",
      planAPath,
      planBPath,
    ]);

    expect(exitCode).toBe(0);
    expect(output).toContain("plan-a");
    expect(output).toContain("plan-b");
    expect(output).toMatch(/parallel-safe|clean/i);
  });

  it("two conflicting plans: exit 0, report shows shared file and severity", async () => {
    const planAPath = join(tmpDir, "a.md");
    const planBPath = join(tmpDir, "b.md");
    const mdA = makePlanMd("plan-a");
    const mdB = makePlanMd("plan-b");
    await writeFile(planAPath, mdA);
    await writeFile(planBPath, mdB);
    await seedCache(stateRoot, mdA, "plan-a", [], ["src/shared.ts"]);
    await seedCache(stateRoot, mdB, "plan-b", [], ["src/shared.ts"]);

    const { code: exitCode, out: output } = await phaxCall([
      "plans",
      "overlap",
      planAPath,
      planBPath,
    ]);

    expect(exitCode).toBe(0);
    expect(output).toContain("src/shared.ts");
    expect(output).toMatch(/medium/i);
  });

  it("--no-extract on uncached plan: exit 1 without success output", async () => {
    const planAPath = join(tmpDir, "a.md");
    const planBPath = join(tmpDir, "b.md");
    const mdA = makePlanMd("plan-a");
    const mdB = makePlanMd("plan-b");
    await writeFile(planAPath, mdA);
    await writeFile(planBPath, mdB);
    // Seed only planA's cache entry; planB is uncached
    await seedCache(stateRoot, mdA, "plan-a", ["src/foo.ts"], []);

    const { code: exitCode, out } = await phaxCall([
      "plans",
      "overlap",
      "--no-extract",
      planAPath,
      planBPath,
    ]);

    expect(exitCode).toBe(1);
    expect(out).toBe("");
  });

  it("missing path: exit 1 and error mentions the path", async () => {
    const planAPath = join(tmpDir, "a.md");
    const mdA = makePlanMd("plan-a");
    await writeFile(planAPath, mdA);
    await seedCache(stateRoot, mdA, "plan-a", ["src/foo.ts"], []);
    const missingPath = join(tmpDir, "missing.md");

    const { code: exitCode, err } = await phaxCall(["plans", "overlap", planAPath, missingPath]);

    expect(exitCode).toBe(1);
    expect(err).toContain("missing.md");
  });

  it("fewer than two paths: exit 1", async () => {
    const planAPath = join(tmpDir, "a.md");
    const mdA = makePlanMd("plan-a");
    await writeFile(planAPath, mdA);
    await seedCache(stateRoot, mdA, "plan-a", ["src/foo.ts"], []);

    const { code: exitCode } = await phaxCall(["plans", "overlap", planAPath]);

    expect(exitCode).toBe(1);
  });

  it("--json: exit 0 and output parses as JSON with edges/cleanPairs/waves keys", async () => {
    const planAPath = join(tmpDir, "a.md");
    const planBPath = join(tmpDir, "b.md");
    const mdA = makePlanMd("plan-a");
    const mdB = makePlanMd("plan-b");
    await writeFile(planAPath, mdA);
    await writeFile(planBPath, mdB);
    await seedCache(stateRoot, mdA, "plan-a", ["src/foo.ts"], []);
    await seedCache(stateRoot, mdB, "plan-b", ["src/bar.ts"], []);

    const { code: exitCode, out } = await phaxCall([
      "plans",
      "overlap",
      "--json",
      planAPath,
      planBPath,
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(out) as unknown;
    expect(parsed).toHaveProperty("edges");
    expect(parsed).toHaveProperty("cleanPairs");
    expect(parsed).toHaveProperty("waves");
    // Sets are emitted as arrays
    const fp = (parsed as { footprints: Array<{ all: unknown }> }).footprints[0];
    expect(Array.isArray(fp?.all)).toBe(true);
  });

  it("second call with same cached plans does not trigger config error on warm hit", async () => {
    const planAPath = join(tmpDir, "a.md");
    const planBPath = join(tmpDir, "b.md");
    const mdA = makePlanMd("plan-a");
    const mdB = makePlanMd("plan-b");
    await writeFile(planAPath, mdA);
    await writeFile(planBPath, mdB);
    await seedCache(stateRoot, mdA, "plan-a", ["src/foo.ts"], []);
    await seedCache(stateRoot, mdB, "plan-b", ["src/bar.ts"], []);

    const first = await phaxCall(["plans", "overlap", planAPath, planBPath]);
    const second = await phaxCall(["plans", "overlap", planAPath, planBPath]);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
  });
});
