// estimatePlanCost on the fake FileSystem, Git and Backend with a made-up
// plan and a generated history: no model reads the plan, --no-probe calls no
// Backend method, artifact validation refuses an off-grammar name, a codex
// phase is not estimated, and no Claude Code credential path is ever touched.
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { estimatePlanCost, readEstimatePlan } from "../../src/app/estimatePlan.js";
import { PROVIDER_CONFIG_PATH } from "../../src/app/loadRouting.js";
import { renderEstimate } from "../../src/domain/cost/estimateRender.js";
import { PROBE_PROMPT } from "../../src/domain/cost/probe.js";
import { ArtifactValidationError, PlanUnparseableError } from "../../src/domain/errors.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem, type FakeFileSystemImpl } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { FileSystem, type FileSystemOps } from "../../src/ports/fs.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import {
  HOUR_MS,
  NOW_MS,
  daysAgo,
  generateHistory,
  generateHistoryWithInteractive,
  INTERACTIVE_TURN_USD,
  iso,
  ledgerEntry,
  ledgerJson,
  rateLimitSample,
  registryEntry,
  seedGeneratedRuns,
} from "../helpers/costHistory.js";

const STATE = "/state";
const REPO = "/repo";
const NOW = iso(NOW_MS);
const PLAN_REL = "docs/plans/2610170900-made-up-plan.md";
const PLAN_PATH = `${REPO}/${PLAN_REL}`;
const PLAN_MARKER = "MADE-UP-PLAN-MARKER";

const config = {
  stateRoot: STATE,
  namespace: "demo",
  repoRoot: REPO,
  raw: { version: 1, name: "demo", state: { root: STATE }, gateProfiles: {} },
  security: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only", allowDomains: [] },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  },
  complianceReview: { enabled: false, model: "claude-sonnet-5-5", effort: "medium" },
} as unknown as ResolvedConfig;

function phaseSection(
  id: string,
  title: string,
  model: string,
  edit: string,
  interactive = false,
): string {
  return `## ${id} — ${title} {#${id}-made-up}

**Recommended model:** ${model}
**Recommended effort:** high
${interactive ? "**Mode:** interactive\n" : ""}
### Planned files to create

- \`src/created-${id}.ts\`

### Planned files to edit

${edit}

### Optional files that may be edited

- (none)

### Commit subject

feat(demo): ${title}

### Commit body

${PLAN_MARKER} does ${id}.
`;
}

/** A third phase, declared interactive, on Opus: its turns are priced as the reference model's. */
function planMd(phase02Model = "claude-sonnet-5-5", withInteractivePhase = false): string {
  return `---
status: Approved
source-spec: null
approved:
  date: 2026-10-17
  baseline: abc1234
---
# ${PLAN_MARKER} Thing

## Required commands

- (none)

${phaseSection("phase-01", "First", "claude-opus-5-5", "- `src/a.ts`\n- `src/gone.ts`")}
${phaseSection("phase-02", "Second", phase02Model, "- (none)")}${
    withInteractivePhase
      ? `\n${phaseSection("phase-03", "Third", "claude-opus-5-5", "- (none)", true)}`
      : ""
  }`;
}

/** Every path a FileSystem method was handed, in call order. */
function tracedFileSystem(impl: FakeFileSystemImpl): {
  readonly layer: Layer.Layer<FileSystem>;
  readonly paths: string[];
} {
  const paths: string[] = [];
  const traced = new Proxy(impl, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        for (const arg of args) if (typeof arg === "string") paths.push(arg);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as FileSystemOps;
  return { layer: Layer.succeed(FileSystem, traced), paths };
}

const FIVE_HOUR_RESET_S = (NOW_MS + 2 * HOUR_MS) / 1000;
const SEVEN_DAY_RESET_S = (NOW_MS + 50 * HOUR_MS) / 1000;

const probeLines = [
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "aaaaaaaa-0000-4000-8000-000000000001",
    claude_code_version: "2.1.302",
    apiKeySource: "none",
  }),
  JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      unifiedWindows: {
        five_hour: { utilization: 0.15, resetsAt: FIVE_HOUR_RESET_S },
        seven_day: { utilization: 0.29, resetsAt: SEVEN_DAY_RESET_S },
      },
    },
  }),
];

const SAMPLE_ENDED_AT = daysAgo(1);

function setup(
  options: {
    readonly plan?: string;
    readonly codexEnabled?: boolean;
    readonly undecodablePlans?: number;
    readonly unledgeredRuns?: readonly string[];
    /** The history also holds past interactive phases whose turns were costed. */
    readonly interactiveHistory?: boolean;
  } = {},
) {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const backend = makeFakeBackend();
  fs.impl.setFile(PLAN_PATH, options.plan ?? planMd());
  fs.impl.setFile(`${REPO}/src/a.ts`, "x".repeat(2048));
  if (options.codexEnabled === true) {
    fs.impl.setFile(
      PROVIDER_CONFIG_PATH,
      JSON.stringify({
        providers: {
          ...DEFAULT_PROVIDER_CONFIG.providers,
          "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
        },
      }),
    );
  }
  // Another namespace's run holds the last rate-limit samples.
  const sampler = registryEntry({ namespace: "elsewhere", shortName: "sampler", runId: "run-s" });
  fs.impl.setFile(
    `${STATE}/runs/elsewhere.sampler/cost-ledger.json`,
    ledgerJson([
      ledgerEntry({
        costUsd: 2,
        endedAt: SAMPLE_ENDED_AT,
        samples: [
          rateLimitSample("five-hour", 40, iso(NOW_MS + HOUR_MS), 1),
          rateLimitSample("seven-day", 60, iso(NOW_MS + 30 * HOUR_MS), 2),
        ],
      }),
    ]),
  );
  // Runs of this namespace whose phax-plan.json predates the current format.
  const undecodable = Array.from({ length: options.undecodablePlans ?? 0 }, (_, index) => {
    const entry = registryEntry({ shortName: `old-${index}`, runId: `run-old-${index}` });
    fs.impl.setFile(`${STATE}/runs/demo.old-${index}/cost-ledger.json`, ledgerJson([]));
    fs.impl.setFile(`${STATE}/runs/demo.old-${index}/phax-plan.json`, "{}");
    return entry;
  });
  // Kept runs with no cost ledger yet: a folder holding no Claude stream.
  const unledgered = (options.unledgeredRuns ?? []).map((shortName) => {
    fs.impl.setFile(`${STATE}/runs/demo.${shortName}/run-status.json`, "{}");
    return registryEntry({ shortName, runId: `run-${shortName}` });
  });
  seedGeneratedRuns(fs.impl, git.impl, {
    stateRoot: STATE,
    namespace: "demo",
    runs:
      options.interactiveHistory === true
        ? generateHistoryWithInteractive({ seed: 3 })
        : generateHistory({ runs: 16, phasesPerRun: 4, seed: 3 }),
    extra: [sampler, ...undecodable, ...unledgered],
  });
  const traced = tracedFileSystem(fs.impl);
  const lock = makeFakeLock();
  const layer = Layer.mergeAll(traced.layer, git.layer, backend.layer, lock.layer);
  return { fs: fs.impl, backend: backend.impl, lock: lock.impl, paths: traced.paths, layer };
}

function estimate(layer: ReturnType<typeof setup>["layer"], probe: boolean, planRel = PLAN_REL) {
  return Effect.runPromiseExit(
    estimatePlanCost({
      planMdPath: `${REPO}/${planRel}`,
      repoRelPath: planRel,
      config,
      nowIso: NOW,
      probe,
    }).pipe(Effect.provide(layer)),
  );
}

/** The typed error an exit failed with, or undefined when it succeeded or died. */
function failureOf<A, E>(exit: Exit.Exit<A, E>): E | undefined {
  return Exit.isFailure(exit) ? Option.getOrUndefined(Cause.failureOption(exit.cause)) : undefined;
}

function credentialPaths(paths: readonly string[]): string[] {
  return paths.filter(
    (path) => path.split("/").includes(".claude") || path.endsWith(".credentials.json"),
  );
}

describe("estimatePlanCost", () => {
  it("estimates an Approved plan never extracted, and only the probe reaches a model (§8 no model reads the plan)", async () => {
    const { fs, backend, layer } = setup();
    backend.addProbeResponse({ lines: probeLines, exitCode: 0 });
    const filesBefore = new Map(fs.files);

    const exit = await estimate(layer, true);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    const { report } = exit.value;
    expect(report.verdict).not.toBe("thin-history");
    expect(report.history.phases).toBeGreaterThanOrEqual(60);
    expect(report.phases.map((phase) => phase.id)).toEqual(["phase-01", "phase-02"]);
    expect(report.phases[0]).toMatchObject({
      provider: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
    });
    expect(report.phases[0]!.estimate).not.toBeNull();
    expect(report.run).not.toBeNull();
    expect(report.windows).toMatchObject({
      source: "probe",
      observedAt: NOW,
      fiveHour: { utilization: 15 },
      sevenDay: { utilization: 29 },
    });

    expect(backend.probeCalls).toHaveLength(1);
    expect(backend.probeCalls[0]!.prompt).toBe(PROBE_PROMPT);
    expect(backend.probeCalls[0]!.prompt).not.toContain(PLAN_MARKER);
    expect(backend.runCalls).toHaveLength(0);
    expect(backend.resumeCalls).toHaveLength(0);
    expect(backend.completeCalls).toHaveLength(0);
    // Every run has a ledger, so the estimate writes nothing.
    expect(fs.files).toEqual(filesBefore);
  });

  it("backfills a kept run with no cost ledger before reading the history, skipping a locked one", async () => {
    const { fs, lock, layer } = setup({ unledgeredRuns: ["fresh", "busy"] });
    lock.setStatus("demo.busy", { kind: "active", pid: 4242, updatedAt: iso(NOW_MS) });

    const exit = await estimate(layer, false);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    expect(exit.value.backfilledLedgers).toBe(1);
    expect(fs.files.has(`${STATE}/runs/demo.fresh/cost-ledger.json`)).toBe(true);
    expect(fs.files.has(`${STATE}/runs/demo.busy/cost-ledger.json`)).toBe(false);
    expect(exit.value.report.history.unledgeredRuns).toBe(1);
  });

  it("with --no-probe calls no Backend method and reads the last sample (§8 --no-probe)", async () => {
    const { backend, layer } = setup();

    const exit = await estimate(layer, false);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    expect(exit.value.report.windows).toMatchObject({
      source: "last-sample",
      observedAt: SAMPLE_ENDED_AT,
      fiveHour: { utilization: 40 },
      sevenDay: { utilization: 60 },
    });
    expect(backend.probeCalls).toHaveLength(0);
    expect(backend.runCalls).toHaveLength(0);
    expect(backend.resumeCalls).toHaveLength(0);
    expect(backend.completeCalls).toHaveLength(0);
  });

  it("still estimates a plan with a departing test line, its departing entry left out", async () => {
    const departing = planMd().replace(
      "### Commit subject\n\nfeat(demo): First",
      "### Test strategy\n\n- add unit tests for the exporter\n\n### Commit subject\n\nfeat(demo): First",
    );
    expect(departing).not.toBe(planMd());
    const { layer } = setup({ plan: departing });

    const exit = await estimate(layer, false);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    expect(exit.value.report.phases.map((p) => p.id)).toEqual(["phase-01", "phase-02"]);
  });

  it("gives one warning per skip reason, naming its first three paths", async () => {
    const { layer } = setup({ undecodablePlans: 5 });

    const exit = await estimate(layer, false);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    const skips = exit.value.report.warnings.filter((warning) => warning.includes("demo.old-"));
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatch(/^5 files: .* — .*demo\.old-0.*, .*, .* and 2 more$/);
  });

  it("fails with ArtifactValidationError on an off-grammar docs/plans/ name (§8 exit codes)", async () => {
    const offGrammar = "docs/plans/made-up-plan.md";
    const { fs, backend, layer } = setup();
    fs.setFile(`${REPO}/${offGrammar}`, planMd());

    const exit = await estimate(layer, true, offGrammar);

    expect(failureOf(exit)).toBeInstanceOf(ArtifactValidationError);
    expect(backend.probeCalls).toHaveLength(0);
  });

  it("fails with PlanUnparseableError, naming phax plans lint, on a plan the parser cannot read", async () => {
    const loose = "notes/plan.md";
    const { fs, layer } = setup();
    fs.setFile(`${REPO}/${loose}`, "# A plan with no phases\n");

    const exit = await estimate(layer, false, loose);

    const error = failureOf(exit);
    expect(error).toBeInstanceOf(PlanUnparseableError);
    expect((error as PlanUnparseableError).message).toContain("phax plans lint");
  });

  it("lists a codex-routed phase as other-provider", async () => {
    const { backend, layer } = setup({ plan: planMd("gpt-6-sol"), codexEnabled: true });
    backend.addProbeResponse({ lines: probeLines, exitCode: 0 });

    const exit = await estimate(layer, true);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    expect(exit.value.report.phases[1]).toEqual({
      id: "phase-02",
      provider: "codex-cli",
      model: "gpt-6-sol",
      effort: "high",
      mode: "headless",
      estimate: null,
      notEstimated: "other-provider",
    });
  });

  it("names an interactive phase as interactive and sizes only its turns, in its own row (§8 only phax's turns are costed)", async () => {
    const { backend, layer } = setup({
      plan: planMd("claude-sonnet-5-5", true),
      interactiveHistory: true,
    });

    const exit = await estimate(layer, false);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    const { report } = exit.value;
    // `phax plans estimate <plan> --no-probe --json` prints this report.
    const json = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(backend.probeCalls).toHaveLength(0);
    expect(json.phases.map((phase) => [phase.id, phase.mode])).toEqual([
      ["phase-01", "headless"],
      ["phase-02", "headless"],
      ["phase-03", "interactive"],
    ]);
    // 60 headless phases of history: the past interactive phases' turns are no sample.
    expect(json.history.phases).toBe(60);
    // The turns of the three past interactive phases, on the same model.
    const [low, mid, high] = INTERACTIVE_TURN_USD;
    const turns = json.phases[2]!.estimate!;
    expect(turns.p10).toBeCloseTo(low, 2);
    expect(turns.p50).toBeCloseTo(mid, 2);
    expect(turns.p90).toBeCloseTo(high, 2);

    const text = renderEstimate(report, { timeZone: "UTC", nowMs: NOW_MS });
    expect(text).toMatch(/^phase-03 +claude-opus-5-5 +interactive +0\.50 +0\.80 +1\.10$/m);
    expect(text).toContain(
      "Interactive phases: first and closing turns only; the person's work is not estimated.",
    );
    expect(text.indexOf("phase-02 ")).toBeLessThan(text.indexOf("phase-03 "));
    expect(text.indexOf("phase-03 ")).toBeLessThan(text.indexOf("run  "));
  });

  it("says an interactive phase has too few past interactive phases when the history holds none", async () => {
    const { layer } = setup({ plan: planMd("claude-sonnet-5-5", true) });

    const exit = await estimate(layer, false);

    if (!Exit.isSuccess(exit)) throw new Error(`estimate failed: ${String(exit.cause)}`);
    const { report } = exit.value;
    expect(report.phases[2]).toMatchObject({
      id: "phase-03",
      mode: "interactive",
      estimate: null,
      notEstimated: "thin-interactive-history",
    });
    expect(renderEstimate(report, { timeZone: "UTC", nowMs: NOW_MS })).toContain(
      "phase-03 (claude-code, too few past interactive phases)",
    );
  });

  it("never touches a Claude Code credential path, with or without the probe (§8 no credential is read)", async () => {
    for (const probe of [true, false]) {
      const { backend, paths, layer } = setup();
      backend.addProbeResponse({ lines: probeLines, exitCode: 0 });

      const exit = await estimate(layer, probe);

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(credentialPaths(paths)).toEqual([]);
    }
  });
});

describe("readEstimatePlan", () => {
  it("sizes each phase's planned files in the working tree, a missing file counting 0", async () => {
    const { layer } = setup();

    const phases = await Effect.runPromise(
      readEstimatePlan({ planMdPath: PLAN_PATH, repoRelPath: PLAN_REL, config }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(
      phases.map(({ phase, editBytes, optionalBytes, createCount }) => ({
        id: phase.id,
        editBytes,
        optionalBytes,
        createCount,
      })),
    ).toEqual([
      { id: "phase-01", editBytes: 2048, optionalBytes: 0, createCount: 1 },
      { id: "phase-02", editBytes: 0, optionalBytes: 0, createCount: 1 },
    ]);
  });

  it("reads a plan with a departing test line, keeping only its formatted lines", async () => {
    const departing = planMd().replace(
      "### Commit subject\n\nfeat(demo): First",
      [
        "### Test strategy",
        "",
        "- add unit tests for the exporter",
        "- a row renders — small · example · the row · in-phase",
        "",
        "### Commit subject",
        "",
        "feat(demo): First",
      ].join("\n"),
    );
    const { layer } = setup({ plan: departing });

    const phases = await Effect.runPromise(
      readEstimatePlan({ planMdPath: PLAN_PATH, repoRelPath: PLAN_REL, config }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(phases.map(({ phase }) => phase.testLines.map((l) => l.guarantee))).toEqual([
      ["a row renders"],
      [],
    ]);
  });
});
