// ac-own-legacy for run files: a run-status.json written before phax wrote
// `$schema` (`version: 1`) is still read by the dispatcher and by run info, and
// rewritten with `$schema` first on the next state change. A phase status
// written before `$schema` lacks `base` and is refused
// (tests/unit/persisted.test.ts), so the phase status here is one phax writes
// today. Every run directory here is made up.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/app/dispatcher.js";
import { loadPlan } from "../../src/app/loadPlan.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import {
  decodeShortName,
  type ClaudeSessionId,
  type PhaseId,
  type RunId,
  type WorktreePath,
} from "../../src/domain/branded.js";
import { runLs } from "../../src/cli/commands/ls.js";
import { PlanValidationError, RateLimitError } from "../../src/domain/errors.js";
import type { PhaxEvent } from "../../src/domain/events.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { runStatusFile } from "../helpers/runStatusFixture.js";

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));

const NAMESPACE = "example";
const SHORT_NAME = "example-run";
const CREATED_AT = "2026-01-01T09:00:00.000Z";

const preSchemaRunStatus = {
  version: 1,
  namespace: NAMESPACE,
  shortName: SHORT_NAME,
  runId: "run-0001",
  state: "running",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  phasesCount: 1,
  currentPhaseIndex: 0,
  gateProfileId: "standard",
  planRepoRelPath: "docs/plans/example.md",
};

const phaseStatus = phaseStatusFile({
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "running",
  model: "example-model",
  effort: "medium",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  branchName: "phax/example-run--phase-01",
  base: "0123456789abcdef0123456789abcdef01234567",
  worktreePath: "/work/example-repo/worktrees/phase-01",
  claudeSessionId: "session-0001",
});

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function withoutKeys(doc: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !keys.includes(key)));
}

describe("a run status written before $schema", () => {
  let stateRoot: string;
  let runPath: string;
  let runStatusPath: string;
  let phaseStatusPath: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-legacy-run-"));
    runPath = join(stateRoot, "runs", `${NAMESPACE}.${SHORT_NAME}`);
    runStatusPath = join(runPath, "run-status.json");
    phaseStatusPath = join(runPath, "phase-01", "status.json");
    mkdirSync(join(runPath, "phase-01"), { recursive: true });
    writeFileSync(runStatusPath, JSON.stringify(preSchemaRunStatus, null, 2));
    writeFileSync(phaseStatusPath, JSON.stringify(phaseStatus, null, 2));
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("is read by run info (loadRunReviewInfo)", () => {
    const result = resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT_NAME)), stateRoot);
    if (Either.isLeft(result)) throw new Error(result.left);
    expect(result.right.runId).toBe("run-0001");
    expect(result.right.runState).toBe("running");
    expect(result.right.gateProfileId).toBe("standard");
    expect(result.right.phaseStatuses).toHaveLength(1);
    expect(result.right.phaseStatuses[0]).toEqual(withoutKeys(phaseStatus, "$schema"));
  });

  it("is read by the dispatcher, and one transition rewrites it with $schema first", async () => {
    const layer = Layer.mergeAll(
      NodeFileSystemLayer,
      makeFakeSystemTelemetry().layer,
      makeFakeGit().layer,
      makeFakeShell().layer,
    );
    const event: PhaxEvent = {
      type: "RateLimitDetected",
      eventId: "evt-0001",
      occurredAt: "2026-01-01T10:00:00.000Z",
      run: SHORT_NAME as RunId,
      phase: "phase-01" as PhaseId,
      kind: "rate_limit",
      cause: new RateLimitError({ message: "rate limited", rawMessage: "429 example" }),
      worktreePath: phaseStatus.worktreePath as WorktreePath,
      sessionId: phaseStatus.claudeSessionId as ClaudeSessionId,
    };

    const result = await Effect.runPromise(
      dispatch(event, {
        runPath,
        shortName: SHORT_NAME,
        phaseFolderPath: join(runPath, "phase-01"),
        phaseId: "phase-01",
      }).pipe(Effect.provide(layer)),
    );
    expect(result.disposition).toBe("Handled");
    expect(result.stateBefore).toMatchObject({ run: "running", phase: { state: "running" } });

    const runStatus = readJson(runStatusPath);
    expect(Object.keys(runStatus)[0]).toBe("$schema");
    expect(runStatus["$schema"]).toBe(currentSchemaUrl("run-status"));
    expect(runStatus).not.toHaveProperty("version");
    expect(
      withoutKeys(runStatus, "$schema", "state", "updatedAt", "stoppedReason", "lastError"),
    ).toEqual({
      ...withoutKeys(preSchemaRunStatus, "version", "state", "updatedAt"),
      hold: { selection: "none" },
    });
    expect(runStatus["state"]).toBe("rate_limited");

    const rewritten = readJson(phaseStatusPath);
    expect(withoutKeys(rewritten, "state", "updatedAt")).toEqual(
      withoutKeys(phaseStatus, "state", "updatedAt"),
    );
    expect(rewritten["state"]).toBe("rate_limited");

    const reread = resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT_NAME)), stateRoot);
    expect(Either.isRight(reread)).toBe(true);
  });

  it("fails with a message naming the file when a status file is in no known shape", () => {
    writeFileSync(runStatusPath, JSON.stringify({ ...preSchemaRunStatus, version: 7 }));
    const result = resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT_NAME)), stateRoot);
    if (Either.isRight(result)) throw new Error("expected a failure");
    expect(result.left.startsWith(`${runStatusPath}: run status without $schema`)).toBe(true);
  });
});

// ac-in-flight: a run started by phax 0.32.0 holds a phax-plan.json stamped
// 0.32.0, whose test lines state the loop `oracle`. This phax shows the run and
// never resumes it: `phax resume` and `phax validate --plan` read the plan
// through `loadPlan`, which refuses it, naming the two ways out.
describe("a run whose phax-plan.json an earlier release stamped", () => {
  let stateRoot: string;
  let runPath: string;
  let planPath: string;

  const oldLine = {
    guarantee: "every pair is refused as the table says",
    size: "small",
    technique: "table",
    oracle: "transition table",
    loop: "oracle",
    criterion: "AC-1",
  };
  const phase = (id: string, index: number) => ({
    id,
    title: `Step ${id}`,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: index === 0 ? { dischargedBy: "phase-02", files: ["tests/a.test.ts"] } : null,
    testLines: [oldLine],
    commit: { subject: `feat: ${id}`, body: "Do the step." },
  });
  const plan = (release: string) => ({
    $schema: schemaUrl("phax-plan", release),
    run: {
      shortName: SHORT_NAME,
      title: "Example run",
      branch: `phax/${SHORT_NAME}`,
      requiredCommands: [],
    },
    phases: [phase("phase-01", 0), phase("phase-02", 1)],
  });

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-inflight-run-"));
    runPath = join(stateRoot, "runs", `${NAMESPACE}.${SHORT_NAME}`);
    planPath = join(runPath, "phax-plan.json");
    mkdirSync(join(runPath, "phase-01"), { recursive: true });
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(
        runStatusFile({
          namespace: NAMESPACE,
          shortName: SHORT_NAME,
          runId: "run-0001",
          state: "interrupted",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          phasesCount: 2,
          currentPhaseIndex: 0,
          gateProfileId: "standard",
          planRepoRelPath: "docs/plans/example.md",
        }),
        null,
        2,
      ),
    );
    writeFileSync(join(runPath, "phase-01", "status.json"), JSON.stringify(phaseStatus, null, 2));
    writeFileSync(
      join(stateRoot, "registry.json"),
      JSON.stringify({
        $schema: currentSchemaUrl("registry"),
        runs: [
          {
            namespace: NAMESPACE,
            shortName: SHORT_NAME,
            runId: "run-0001",
            state: "interrupted",
            branch: `phax/${SHORT_NAME}`,
            projectName: NAMESPACE,
            phasesCount: 2,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
          },
        ],
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(stateRoot, { recursive: true, force: true });
  });

  // 0.31.0 and 0.28.0 read as the 0.28.0 shape: no phax-plan stamped in
  // [0.28.0, 0.32.0) resumes as current any more.
  it.each([
    ["0.32.0", "0.32.0"],
    ["0.31.0", "0.28.0"],
    ["0.28.0", "0.28.0"],
  ])(
    "is refused by loadPlan, which resume and validate --plan call, when stamped %s, naming the shape and `phax archive <run> --force`",
    (release, shape) => {
      writeFileSync(planPath, JSON.stringify(plan(release), null, 2));
      const qualified = `${NAMESPACE}.${SHORT_NAME}`;

      const result = loadPlan(planPath, { run: qualified });

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isRight(result)) return;
      expect(result.left).toBeInstanceOf(PlanValidationError);
      expect(result.left.message).toContain(`${planPath}: phax-plan in the ${shape} shape`);
      expect(result.left.message).toContain("an older phax wrote it");
      expect(result.left.message).toContain(`\`phax archive ${qualified} --force\``);
    },
  );

  it("is still read for display: resolveRun shows its phases, without test lines", () => {
    writeFileSync(planPath, JSON.stringify(plan("0.32.0"), null, 2));

    const result = resolveRun(NAMESPACE, Either.getOrThrow(decodeShortName(SHORT_NAME)), stateRoot);

    if (Either.isLeft(result)) throw new Error(result.left);
    expect(result.right.planPhases.map((p) => p.id)).toEqual(["phase-01", "phase-02"]);
    expect(result.right.planPhases.every((p) => !("testLines" in p))).toBe(true);
  });

  it("is listed by phax ls, with the phases its plan names", async () => {
    writeFileSync(planPath, JSON.stringify(plan("0.32.0"), null, 2));
    const { loadConfig } = await import("../../src/app/loadConfig.js");
    vi.mocked(loadConfig).mockReturnValue(Either.right(lsConfig(stateRoot)));
    const lines: string[] = [];
    const errors: string[] = [];

    const code = await runLs(
      {},
      {
        log: (m: string) => lines.push(m),
        warn: (m: string) => lines.push(`WARN: ${m}`),
        error: (m: string) => errors.push(m),
      },
    );

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const row = lines
      .join("\n")
      .split("\n")
      .find((l) => l.includes(SHORT_NAME));
    expect(row).toBeDefined();
    // The current phase, `1/2` of the plan's two phases, is read from the old plan.
    expect(row).toContain("1/2");
  });
});

/** The slice of a resolved config `phax ls` reads, with every path made up. */
function lsConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: {} as never,
    namespace: NAMESPACE,
    stateRoot,
    repoRoot: stateRoot,
    maxFixAttempts: 3,
    extractPlanModel: "claude-sonnet-5-5",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: {
      profile: "secure",
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
    complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
    codeReview: { enabled: false, model: "claude-opus-5-5", effort: "high" },
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
  } as unknown as ResolvedConfig;
}
