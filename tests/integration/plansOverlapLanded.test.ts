import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { EXTRACTOR_VERSION, planCacheKey } from "../../src/domain/planCache/key.js";
import { planMdSha256, cacheEntryPath } from "../../src/app/planCacheStore.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { encodeRegistryFile } from "../../src/schemas/registry.js";
import { phaxCall } from "../helpers/runnerCall.js";

vi.mock("../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

const MODEL = "claude-haiku-4-5-20251001";
const EFFORT = "low";
const NAMESPACE = "test";

function makeBaseConfig(stateRoot: string): ResolvedConfig {
  return {
    stateRoot,
    namespace: NAMESPACE,
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
      name: NAMESPACE,
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
      optionalInPhases: [],
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
      optionalInPhases: [],
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
      optionalInPhases: [],
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
    vi.mocked(loadConfig).mockReturnValue(Either.right(makeBaseConfig(stateRoot)));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("landed run with shared source file: exit 0, report lists impacted plan and shared file", async () => {
    const planPath = join(tmpDir, "plan-a.md");
    const md = makePlanMd("plan-a");
    await writeFile(planPath, md);
    await seedCache(stateRoot, md, "plan-a", [], ["src/shared.ts"]);

    await buildFakeRunFolder(
      stateRoot,
      "landed-run",
      makeReconciliation([], ["src/shared.ts"], []),
    );

    const { code: exitCode, out: output } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      "landed-run",
      planPath,
    ]);

    expect(exitCode).toBe(0);
    expect(output).toContain("src/shared.ts");
    expect(output).toContain("plan-a");
    expect(output).toMatch(/impacted|re-adjustment/i);
  });

  it("landed run with no shared files: exit 0, plan listed as unaffected", async () => {
    const planPath = join(tmpDir, "plan-b.md");
    const md = makePlanMd("plan-b");
    await writeFile(planPath, md);
    await seedCache(stateRoot, md, "plan-b", ["src/other.ts"], []);

    await buildFakeRunFolder(
      stateRoot,
      "landed-run",
      makeReconciliation(["src/different.ts"], [], []),
    );

    const { code: exitCode, out: output } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      "landed-run",
      planPath,
    ]);

    expect(exitCode).toBe(0);
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
    await seedCache(stateRoot, md, "plan-c", ["src/foo.ts"], []);

    const { code: exitCode, err } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      "empty-run",
      planPath,
    ]);

    expect(exitCode).toBe(1);
    expect(err).toMatch(/reconciliation|review/i);
  });

  it("--json: exit 0 and output parses with impacted/unaffected keys", async () => {
    const planPath = join(tmpDir, "plan-d.md");
    const md = makePlanMd("plan-d");
    await writeFile(planPath, md);
    await seedCache(stateRoot, md, "plan-d", [], ["src/touched.ts"]);

    await buildFakeRunFolder(
      stateRoot,
      "landed-run",
      makeReconciliation([], ["src/touched.ts"], []),
    );

    const { code: exitCode, out } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      "landed-run",
      "--json",
      planPath,
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(out) as unknown;
    expect(parsed).toHaveProperty("impacted");
    expect(parsed).toHaveProperty("unaffected");
    expect(parsed).toHaveProperty("landedLabel");
  });

  it("invalid run name: exit 1 without hitting the filesystem", async () => {
    const planPath = join(tmpDir, "plan-e.md");
    await writeFile(planPath, makePlanMd("plan-e"));

    const { code: exitCode, err } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      "INVALID_NAME",
      planPath,
    ]);

    expect(exitCode).toBe(1);
    expect(err).toContain('"INVALID_NAME" is not a valid run short name');
  });

  it("archived run: reads the landed diff from the archive folder", async () => {
    const planPath = join(tmpDir, "plan-f.md");
    const md = makePlanMd("plan-f");
    await writeFile(planPath, md);
    await seedCache(stateRoot, md, "plan-f", [], ["src/shared.ts"]);

    const archivePath = join(stateRoot, "archive", `${NAMESPACE}.shipped-run`);
    await mkdir(join(archivePath, "runs"), { recursive: true });
    await writeFile(
      join(archivePath, "runs", "global-file-reconciliation.json"),
      JSON.stringify(makeReconciliation([], ["src/shared.ts"], [])),
    );
    const now = "2026-06-01T00:00:00.000Z";
    await writeFile(
      join(stateRoot, "registry.json"),
      JSON.stringify(
        encodeRegistryFile(
          withSchemaUrl("registry", {
            runs: [
              {
                namespace: NAMESPACE,
                shortName: "shipped-run",
                runId: "shipped-001",
                state: "archived" as const,
                branch: "phax/shipped-run",
                projectName: NAMESPACE,
                phasesCount: 1,
                createdAt: now,
                updatedAt: now,
                archivePath,
              },
            ],
          }),
        ),
      ),
    );

    const { code: exitCode, out: output } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      "shipped-run",
      planPath,
    ]);

    expect(exitCode).toBe(0);
    expect(output).toContain("src/shared.ts");
    expect(output).toContain(`${NAMESPACE}.shipped-run`);
    expect(output).toMatch(/impacted|re-adjustment/i);
  });

  it("qualified <namespace>.<short> name on a live run is accepted", async () => {
    const planPath = join(tmpDir, "plan-g.md");
    const md = makePlanMd("plan-g");
    await writeFile(planPath, md);
    await seedCache(stateRoot, md, "plan-g", [], ["src/shared.ts"]);

    await buildFakeRunFolder(
      stateRoot,
      "landed-run",
      makeReconciliation([], ["src/shared.ts"], []),
    );

    const { code: exitCode, out } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      `${NAMESPACE}.landed-run`,
      planPath,
    ]);

    expect(exitCode).toBe(0);
    expect(out).toContain("src/shared.ts");
  });

  it("unknown run: exit 1 naming the run as unknown", async () => {
    const planPath = join(tmpDir, "plan-h.md");
    await writeFile(planPath, makePlanMd("plan-h"));

    const { code: exitCode, err } = await phaxCall([
      "plans",
      "overlap",
      "--landed",
      "never-ran",
      planPath,
    ]);

    expect(exitCode).toBe(1);
    expect(err).toContain(`Run "${NAMESPACE}.never-ran" is unknown`);
  });
});
