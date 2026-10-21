import { Effect, Either, Layer } from "effect";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { verifiedSurfaces } from "../../src/domain/gate/verifiedSurfaces.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";
import { resetPhase, ResetPhaseError } from "../../src/app/resetPhase.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId, type RunId } from "../../src/domain/branded.js";
import {
  GateAttemptsExhaustedError,
  GateStepRefusedError,
  OracleCommitMissingError,
  PhaseHadNoChangesError,
} from "../../src/domain/errors.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { Shell, type ShellRunOptions, type ShellRunResult } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";

// Full runs of acme-billing's made-up refunds plans on a fake backend and fake
// git, over a real run folder. The oracles provider is a scripted fake: it
// records every request it reads, and answers as each test chooses.

const NAMESPACE = "acme-billing";
const SHORT_NAME = "refunds";
const BRANCH = "phax/refunds";
const ORACLES = "./oracles";
const ORACLE_FILES = ["tests/refunds.test.ts", "tests/prune.test.ts"];
const shortName = Either.getOrThrow(decodeShortName(SHORT_NAME));

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Phase completed successfully.",
  "## Key decisions and why",
  "No major decisions.",
  "## Exact locations (file paths and exported names)",
  "No new exports.",
  "## What the next phase needs to know",
  "Ready to proceed.",
].join("\n");

const reportUrl = currentSchemaUrl("gate-report");
const passing = JSON.stringify({
  $schema: reportUrl,
  outcome: "checked",
  findings: [],
  review: [],
});
const unmarked = JSON.stringify({
  $schema: reportUrl,
  outcome: "checked",
  findings: [
    {
      id: "oracle-marker tests/refunds.test.ts",
      rule: "a discharged oracle file keeps no marker",
      location: { file: "tests/refunds.test.ts", lines: [3, 3] },
      message: "the refund test is still marked",
      related: [],
      guide: null,
    },
  ],
  review: [],
});
const REASON = "the oracle files are not test files";
const REMEDY = "list test files under **Oracle files:**";
const refused = JSON.stringify({
  $schema: reportUrl,
  outcome: "refused",
  reason: REASON,
  remedy: REMEDY,
});

interface Pair {
  readonly oracle: number;
  readonly discharging: number;
  /** The pair's oracle files; defaults to ORACLE_FILES. A second pair names its own. */
  readonly files?: readonly string[];
}

function id(n: number): string {
  return `phase-${String(n).padStart(2, "0")}`;
}

async function oracleRequests(h: { runPath: string }, phase: string): Promise<string[]> {
  return (await readdir(join(h.runPath, phase))).filter((f) => f.endsWith(".oracle-request.json"));
}

function source(p: Pair): string {
  return p.files === undefined ? "src/refunds.ts" : `src/pair-${p.oracle}.ts`;
}

/** A plan of `count` phases; the pair's oracle phase creates the oracle files. */
function planOf(count: number, pairs: Pair | readonly Pair[] | null): PhaxPlan {
  const all = pairs === null ? [] : "oracle" in pairs ? [pairs] : pairs;
  const phases = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const asOracle = all.find((p) => p.oracle === n);
    const asDischarging = all.find((p) => p.discharging === n);
    return {
      id: id(n),
      title: `Step ${n}`,
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: `#${id(n)}`,
      plannedFilesToCreate:
        asOracle !== undefined
          ? [...(asOracle.files ?? ORACLE_FILES), source(asOracle)]
          : asDischarging !== undefined
            ? []
            : [`src/step-${n}.ts`],
      plannedFilesToEdit: asDischarging === undefined ? [] : [source(asDischarging)],
      optionalFilesToEdit: [],
      mode: "headless" as const,
      oracle:
        asOracle === undefined
          ? null
          : { dischargedBy: id(asOracle.discharging), files: asOracle.files ?? ORACLE_FILES },
      commit: { subject: `feat: step ${n}`, body: "Made up." },
    };
  });
  const [first, ...rest] = phases;
  return {
    run: { shortName: SHORT_NAME, title: "Refunds", branch: BRANCH, requiredCommands: [] },
    phases: [first!, ...rest],
  };
}

/** plan.md for `plan`, with the oracle lines in the oracle phase's header. */
function planMdOf(plan: PhaxPlan): string {
  const lines = [`# ${plan.run.title}`, "", "## Required commands", "", "- (none)", ""];
  for (const phase of plan.phases) {
    lines.push(`## ${phase.id} — ${phase.title} {${phase.planMarkdownAnchor}}`, "");
    lines.push(`**Recommended model:** ${phase.model}`, `**Recommended effort:** ${phase.effort}`);
    if (phase.oracle !== null) {
      lines.push(
        `**Oracle phase:** discharged by ${phase.oracle.dischargedBy}`,
        `**Oracle files:** ${phase.oracle.files.map((f) => `\`${f}\``).join(", ")}`,
      );
    }
    lines.push("", `Carry out ${phase.id}'s made-up instructions.`, "");
  }
  return lines.join("\n");
}

function makeConfig(stateRoot: string, provider: boolean, publish: boolean): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: stateRoot },
      gateProfiles: {
        full: [
          { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
          { command: "pnpm lint", surface: "structural", firing: "every-phase", output: "log" },
        ],
      },
    },
    stateRoot,
    namespace: NAMESPACE,
    repoRoot: stateRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    publish: resolvePublishConfig(publish ? { auto: true } : undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    security: {
      profile: "secure",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
    ...(provider ? { oracles: { command: ORACLES } } : {}),
  };
}

/** A full commit name per phase and per commit made in its worktree. */
function tipOf(phase: string, generation: number): string {
  return `${"c".repeat(36)}${phase.slice(-2)}${String(generation).padStart(2, "0")}`;
}

interface ProviderCall {
  readonly cwd: string;
  readonly stdin: string;
  readonly request: Record<string, unknown>;
  /** Commits made in the gated phase's worktree when the provider ran. */
  readonly commitsBefore: number;
}

describe("oracle phases in a run", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-oracle-phases-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  function worktreeOf(phase: string): string {
    return join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, phase);
  }

  async function setup(
    plan: PhaxPlan,
    opts: {
      provider?: boolean;
      answer?: (request: Record<string, unknown>) => string;
      /** Phases whose worktree is clean at the commit: they produce no changes. */
      noChanges?: readonly string[];
      /** Publish the run when it reaches review, as `publish.auto` does. */
      publish?: boolean;
    } = {},
  ) {
    for (const phase of plan.phases) {
      await mkdir(join(worktreeOf(phase.id), ".phax-context"), { recursive: true });
      await writeFile(
        join(worktreeOf(phase.id), ".phax-context", "phase-handoff.md"),
        HANDOFF_CONTENT,
      );
    }
    const config = makeConfig(stateRoot, opts.provider ?? true, opts.publish ?? false);
    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    // Each phase's worktree has changes to commit, then is clean for cleanup.
    for (const phase of plan.phases) {
      if (opts.noChanges?.includes(phase.id) === true) {
        fakeGit.impl.enqueueWorktreeIsClean(worktreeOf(phase.id), true);
      } else {
        fakeGit.impl.enqueueWorktreeIsClean(worktreeOf(phase.id), false, true);
      }
    }
    const fakeBackend = makeFakeBackend();
    for (let i = 0; i < 20; i++) {
      fakeBackend.impl.addRunResponse(session(`sess-${i}`));
      fakeBackend.impl.addResumeResponse(session(`sess-fix-${i}`));
    }

    const commitsIn = (cwd: string) =>
      fakeGit.impl.calls.filter((c) => c.method === "commit" && c.repo === cwd).length;
    const providerCalls: ProviderCall[] = [];
    const shellCalls: ShellRunOptions[] = [];
    // `failConfigured`: how many upcoming runs of the configured `pnpm test` step exit 1.
    const harness = { answer: opts.answer ?? (() => passing), failConfigured: 0 };
    const shell = Layer.succeed(Shell, {
      run: (options: ShellRunOptions) =>
        Effect.sync(() => {
          shellCalls.push(options);
          const command = options.command.join(" ");
          if (command === "git rev-parse HEAD") {
            // The phase's commit: moves its branch, as a real commit would.
            const phase = basename(options.cwd);
            const tip = tipOf(phase, commitsIn(options.cwd));
            fakeGit.impl.setBranchRef(`${BRANCH}--${phase}`, tip);
            return ok(`${tip}\n`);
          }
          if (options.command[0] === ORACLES) {
            const stdin = options.stdin ?? "";
            const request = JSON.parse(stdin) as Record<string, unknown>;
            providerCalls.push({
              cwd: options.cwd,
              stdin,
              request,
              commitsBefore: commitsIn(options.cwd),
            });
            return ok(harness.answer(request));
          }
          if (command === "pnpm test" && harness.failConfigured > 0) {
            harness.failConfigured -= 1;
            return { exitCode: 1, stdout: "", stderr: "1 failed", stdoutEncoding: "utf8" as const };
          }
          return ok("");
        }),
    });

    const layer = Layer.mergeAll(
      fakeGit.layer,
      shell,
      fakeBackend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const planMd = planMdOf(plan);
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMd, plan, config, undefined, true).pipe(Effect.provide(layer)),
    );
    const execute = (startIndex = 0, options: { readonly skipOracle?: boolean } = {}) =>
      Effect.runPromise(
        Effect.either(
          executePlan({
            shortName,
            namespace: NAMESPACE,
            plan,
            planMd,
            config,
            gateProfileId: "full",
            allowDirty: false,
            runPath,
            runId: runId as RunId,
            startIndex,
            securityMode: "secure",
            ...options,
          }).pipe(Effect.provide(layer)),
        ),
      );
    const reset = (phaseId: string) =>
      Effect.runPromise(
        Effect.either(
          resetPhase({
            namespace: NAMESPACE,
            shortName,
            phaseId,
            stateRoot,
            repoRoot: stateRoot,
          }).pipe(Effect.provide(layer)),
        ),
      );
    const readJson = async (...segments: string[]) =>
      JSON.parse(await readFile(join(runPath, ...segments), "utf8")) as Record<string, unknown>;
    /** Notes the phase's agent session, as the agent turn would, so resume can re-enter it. */
    const noteSession = async (phase: string) => {
      const status = await readJson(phase, "status.json");
      await writeFile(
        join(runPath, phase, "status.json"),
        JSON.stringify({ ...status, claudeSessionId: "sess-0" }),
      );
    };
    /** The fix prompts sent so far; the handoff turns resume the session too. */
    const fixPrompts = () =>
      fakeBackend.impl.resumeCalls
        .map((c) => c.prompt)
        .filter((prompt) => !prompt.startsWith("# Generate phase handoff"));
    return {
      runPath,
      execute,
      fixPrompts,
      reset,
      readJson,
      noteSession,
      providerCalls,
      shellCalls,
      harness,
      fakeGit,
      fakeBackend,
    };
  }

  it("asks for an authored verdict at the oracle phase and a discharged one at its discharger", async () => {
    const plan = planOf(3, { oracle: 2, discharging: 3 });
    const h = await setup(plan);
    h.fakeGit.impl.enqueueDiffNameStatus(worktreeOf("phase-03"), [
      { status: "modified", path: "src/refunds.ts" },
      { status: "modified", path: "tests/refunds.test.ts" },
      { status: "modified", path: "tests/prune.test.ts" },
    ]);

    const result = await h.execute();

    expect(Either.isRight(result)).toBe(true);
    expect(h.providerCalls.map((c) => c.cwd)).toEqual([
      worktreeOf("phase-02"),
      worktreeOf("phase-03"),
    ]);
    const [authored, discharged] = h.providerCalls;

    // The authored request: phase-02's base is phase-01's full commit.
    const phase01 = await h.readJson("phase-01", "status.json");
    const phase02 = await h.readJson("phase-02", "status.json");
    expect(phase02["base"]).toBe(phase01["commitHash"]);
    expect(authored!.request).toEqual({
      $schema: expect.stringMatching(/\/schemas\/oracle-request\/[^/]+\.json$/),
      verdict: "authored",
      phase: "phase-02",
      oraclePhase: "phase-02",
      base: phase01["commitHash"],
      files: ORACLE_FILES,
    });
    expect(authored!.commitsBefore).toBe(0);
    expect(
      await readFile(join(h.runPath, "phase-02", "checks-attempt-01.oracle-request.json"), "utf8"),
    ).toBe(authored!.stdin);

    // The discharged request names the tip of phase-02's branch.
    const phase02Tip = await Effect.runPromise(
      h.fakeGit.impl.resolveRef(stateRoot, `${BRANCH}--phase-02`),
    );
    expect(phase02["commitHash"]).toBe(phase02Tip);
    expect(discharged!.request).toEqual({
      $schema: expect.stringMatching(/\/schemas\/oracle-request\/[^/]+\.json$/),
      verdict: "discharged",
      phase: "phase-03",
      oraclePhase: "phase-02",
      base: phase02["base"],
      oracleCommit: phase02Tip,
      files: ORACLE_FILES,
    });

    // Recorded last, under the oracle surface.
    expect((await h.readJson("phase-02", "gate-attribution.json"))["steps"]).toEqual([
      { command: "pnpm test", surface: "local", result: "pass" },
      { command: "pnpm lint", surface: "structural", result: "pass" },
      { command: ORACLES, surface: "oracle", result: "pass" },
    ]);

    // Marker removal in the oracle files is never an unplanned edit.
    const reconciliation = await h.readJson("phase-03", "file-reconciliation.json");
    expect(reconciliation["unplannedEdited"]).toEqual([]);
    expect(reconciliation["editedAsPlanned"]).toEqual(["src/refunds.ts"]);
    expect(reconciliation["optionalTouched"]).toEqual(expect.arrayContaining(ORACLE_FILES));
  });

  it("lists oracle among the PR body's verified surfaces once the pair passed", async () => {
    const h = await setup(planOf(3, { oracle: 2, discharging: 3 }), { publish: true });
    h.fakeGit.impl.addExistingRemote("origin");

    const result = await h.execute();

    expect(Either.isRight(result)).toBe(true);
    const body = await readFile(join(h.runPath, "pr-body.md"), "utf8");
    expect(body).toContain("**Verified surfaces** local, oracle, structural");
  });

  it("calls the provider at the pair's two phases only", async () => {
    const h = await setup(planOf(5, { oracle: 2, discharging: 4 }));

    const result = await h.execute();

    expect(Either.isRight(result)).toBe(true);
    expect(h.providerCalls.map((c) => basename(c.cwd))).toEqual(["phase-02", "phase-04"]);
    for (const phase of ["phase-01", "phase-03", "phase-05"]) {
      const steps = (await h.readJson(phase, "gate-attribution.json"))["steps"] as {
        surface: string;
      }[];
      expect(steps.map((s) => s.surface)).toEqual(["local", "structural"]);
    }
  });

  it("pauses on a refusal, and resume runs that gate again", async () => {
    const h = await setup(planOf(3, { oracle: 2, discharging: 3 }), { answer: () => refused });

    const result = await h.execute();

    if (Either.isRight(result)) throw new Error("expected the run to stop");
    expect(result.left).toBeInstanceOf(GateStepRefusedError);
    expect(result.left).toMatchObject({
      command: ORACLES,
      reason: REASON,
      remedy: REMEDY,
      failedStep: "oracle",
    });
    expect(h.fixPrompts()).toEqual([]);
    expect(await h.readJson("phase-02", "status.json")).toMatchObject({ state: "gates_exhausted" });
    const instructions = await readFile(join(h.runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain(REASON);
    expect(instructions).toContain(REMEDY);
    expect(instructions).toContain("phax resume refunds --yes --skip-oracle");
    expect(instructions).toContain("the phase's configured gate still runs");

    h.harness.answer = () => passing;
    await h.noteSession("phase-02");
    const resumed = await h.execute(1);

    expect(Either.isRight(resumed)).toBe(true);
    expect(h.providerCalls.map((c) => basename(c.cwd))).toEqual([
      "phase-02",
      "phase-02",
      "phase-03",
    ]);
    expect(existsSync(join(h.runPath, "phase-02", "checks-attempt-02.oracle-request.json"))).toBe(
      true,
    );
  });

  it("exhausts an always-finding discharge, resumes with the same commit, and never resets the committed oracle phase", async () => {
    const h = await setup(planOf(3, { oracle: 2, discharging: 3 }), {
      answer: (request) => (request["verdict"] === "discharged" ? unmarked : passing),
    });

    const result = await h.execute();

    if (Either.isRight(result)) throw new Error("expected the run to stop");
    expect(result.left).toBeInstanceOf(GateAttemptsExhaustedError);
    expect(result.left).toMatchObject({ failedStep: "oracle" });
    expect(await h.readJson("phase-03", "status.json")).toMatchObject({ state: "gates_exhausted" });
    const instructions = await readFile(join(h.runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain("the oracle step failed after exhausting all fix attempts");
    expect(instructions).toContain("phax resume refunds --yes");
    expect(instructions).toContain("--skip-oracle");
    expect(instructions).toContain("the phase's configured gate still runs");
    const phase02 = await h.readJson("phase-02", "status.json");
    const discharges = () => h.providerCalls.filter((c) => c.request["verdict"] === "discharged");
    expect(discharges()).toHaveLength(2);
    expect(h.fixPrompts()[0]).toContain("found: the refund test is still marked");

    await h.noteSession("phase-03");
    const resumed = await h.execute(2);

    expect(Either.isLeft(resumed) && resumed.left instanceof GateAttemptsExhaustedError).toBe(true);
    expect(new Set(discharges().map((c) => c.request["oracleCommit"]))).toEqual(
      new Set([phase02["commitHash"]]),
    );

    // The committed oracle phase is not reset, before or after its discharge.
    const statusBefore = await readFile(join(h.runPath, "phase-02", "status.json"), "utf8");
    const refusedReset = await h.reset("phase-02");
    if (Either.isRight(refusedReset)) throw new Error("expected the reset to be refused");
    expect(refusedReset.left).toBeInstanceOf(ResetPhaseError);
    expect(refusedReset.left).toMatchObject({ reason: "phase_blocked_by_discharge" });
    expect(refusedReset.left.message).toBe(
      `Cannot reset "phase-02" of run "refunds": its discharging phase "phase-03" is gates_exhausted, and a committed oracle phase is not reset. To correct the oracle, edit it in phase-03 (\`phax enter-phase refunds phase-03\`), then run \`phax resume refunds --yes --skip-oracle\`: the configured gate still runs.`,
    );
    expect(await readFile(join(h.runPath, "phase-02", "status.json"), "utf8")).toBe(statusBefore);

    expect(Either.isRight(await h.reset("phase-03"))).toBe(true);
    const afterDischargeReset = await h.reset("phase-02");
    if (Either.isRight(afterDischargeReset)) throw new Error("expected the reset to be refused");
    expect(afterDischargeReset.left).toMatchObject({ reason: "not_resettable" });
    expect(await readFile(join(h.runPath, "phase-02", "status.json"), "utf8")).toBe(statusBefore);
    h.harness.answer = () => passing;
    const rerun = await h.execute(2);

    expect(Either.isRight(rerun)).toBe(true);
    expect(discharges().at(-1)?.request["oracleCommit"]).toBe(phase02["commitHash"]);
  });

  describe("a skipped oracle step", () => {
    async function exhaustDischarge(publish: boolean) {
      const h = await setup(planOf(3, { oracle: 2, discharging: 3 }), {
        publish,
        answer: (request) => (request["verdict"] === "discharged" ? unmarked : passing),
      });
      if (publish) h.fakeGit.impl.addExistingRemote("origin");
      const first = await h.execute();
      if (Either.isRight(first)) throw new Error("expected the run to stop");
      expect(first.left).toBeInstanceOf(GateAttemptsExhaustedError);
      await h.noteSession("phase-03");
      return h;
    }

    it("discharges a wrong oracle without a provider call, and never counts it as verified", async () => {
      const h = await exhaustDischarge(true);

      // Without the skip, the provider is asked again for the same commit.
      const callsBefore = h.providerCalls.length;
      const again = await h.execute(2);
      expect(Either.isLeft(again) && again.left instanceof GateAttemptsExhaustedError).toBe(true);
      expect(h.providerCalls).toHaveLength(callsBefore + 2);
      expect(h.providerCalls.at(-1)?.request["verdict"]).toBe("discharged");
      await h.noteSession("phase-03");

      const callsBeforeSkip = h.providerCalls.length;
      const requestsBeforeSkip = await oracleRequests(h, "phase-03");
      const resumed = await h.execute(2, { skipOracle: true });

      expect(Either.isRight(resumed)).toBe(true);
      expect(h.providerCalls).toHaveLength(callsBeforeSkip);
      expect(await oracleRequests(h, "phase-03")).toEqual(requestsBeforeSkip);
      // phase-03 is the final phase: committed, then kept open for review.
      expect(await h.readJson("phase-03", "status.json")).toMatchObject({ state: "review_open" });
      const attribution = await h.readJson("phase-03", "gate-attribution.json");
      const steps = attribution["steps"] as GateAttribution["steps"];
      expect(steps.at(-1)).toEqual({ command: ORACLES, surface: "oracle", result: "skipped" });
      expect(verifiedSurfaces({ phase: "phase-03", steps } as GateAttribution)).toEqual([
        "local",
        "structural",
      ]);
      const body = await readFile(join(h.runPath, "pr-body.md"), "utf8");
      expect(body).toContain("**Verified surfaces** local, structural");
    });

    it("still runs the configured gate and its fix loop", async () => {
      const h = await exhaustDischarge(false);
      const callsBefore = h.providerCalls.length;
      const fixesBefore = h.fixPrompts().length;
      h.harness.failConfigured = 1;

      const resumed = await h.execute(2, { skipOracle: true });

      expect(Either.isRight(resumed)).toBe(true);
      expect(h.fixPrompts()).toHaveLength(fixesBefore + 1);
      expect(h.providerCalls).toHaveLength(callsBefore);
      expect(await h.readJson("phase-03", "status.json")).toMatchObject({ state: "review_open" });
      const steps = (await h.readJson("phase-03", "gate-attribution.json"))["steps"];
      expect(steps).toEqual([
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm lint", surface: "structural", result: "pass" },
        { command: ORACLES, surface: "oracle", result: "skipped" },
      ]);
    });

    it("reaches no later phase", async () => {
      const second = { oracle: 3, discharging: 4, files: ["tests/prune.test.ts"] };
      const h = await setup(planOf(4, [{ oracle: 1, discharging: 2 }, second]), {
        answer: (request) =>
          request["verdict"] === "discharged" && request["phase"] === "phase-02"
            ? unmarked
            : passing,
      });
      const first = await h.execute();
      if (Either.isRight(first)) throw new Error("expected the run to stop");
      expect(first.left).toBeInstanceOf(GateAttemptsExhaustedError);
      h.harness.answer = () => passing;
      await h.noteSession("phase-02");
      const callsBefore = h.providerCalls.length;

      const resumed = await h.execute(1, { skipOracle: true });

      expect(Either.isRight(resumed)).toBe(true);
      expect(h.providerCalls.slice(callsBefore).map((c) => basename(c.cwd))).toEqual([
        "phase-03",
        "phase-04",
      ]);
      expect(h.providerCalls.slice(callsBefore).map((c) => c.request["verdict"])).toEqual([
        "authored",
        "discharged",
      ]);
    });
  });

  it("refuses the discharge of a skipped oracle phase before its agent runs, naming the remedy", async () => {
    const h = await setup(planOf(3, { oracle: 2, discharging: 3 }), { noChanges: ["phase-02"] });

    const first = await h.execute();

    if (Either.isRight(first)) throw new Error("expected the run to pause");
    expect(first.left).toBeInstanceOf(PhaseHadNoChangesError);
    const phase02 = await h.readJson("phase-02", "status.json");
    expect(phase02).toMatchObject({ state: "skipped" });
    expect(phase02["commitHash"]).toBeUndefined();
    const agentRuns = h.fakeBackend.impl.runCalls.length;

    const resumed = await h.execute(2);

    if (Either.isRight(resumed)) throw new Error("expected the discharge to be refused");
    expect(resumed.left).toBeInstanceOf(OracleCommitMissingError);
    expect(resumed.left).toMatchObject({ oraclePhase: "phase-02", dischargingPhase: "phase-03" });
    expect(resumed.left.message).toBe(
      [
        `Cannot run discharging phase "phase-03" of run "refunds": its oracle phase "phase-02" is skipped and noted no commit, so there are no oracles to discharge.`,
        "No resume gives a skipped oracle phase a commit: archive the run (phax archive refunds --force) and run a corrected plan whose oracle phase writes its oracles.",
      ].join("\n"),
    );
    expect(exitCodeForError(resumed.left)).toBe(11);
    // Nothing of phase-03 ran: no agent turn, no gate, no oracle request.
    expect(h.fakeBackend.impl.runCalls.length).toBe(agentRuns);
    expect(h.providerCalls.map((c) => c.request["verdict"])).toEqual(["authored"]);
    expect(existsSync(join(h.runPath, "phase-03", "checks-attempt-01.log"))).toBe(false);
    expect(await h.readJson("run-status.json")).toMatchObject({ state: "failed" });
  });

  it.each([
    ["with a provider configured", true],
    ["without a provider", false],
  ])("runs a plan with no oracle phase unchanged %s", async (_label, provider) => {
    const h = await setup(planOf(2, null), { provider });

    const result = await h.execute();

    expect(Either.isRight(result)).toBe(true);
    expect(h.providerCalls).toEqual([]);
    expect(h.shellCalls.some((c) => c.command[0] === ORACLES)).toBe(false);
    for (const phase of ["phase-01", "phase-02"]) {
      expect((await h.readJson(phase, "gate-attribution.json"))["steps"]).toEqual([
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm lint", surface: "structural", result: "pass" },
      ]);
      expect(existsSync(join(h.runPath, phase, "checks-attempt-01.oracle-request.json"))).toBe(
        false,
      );
    }
  });
});

function session(sessionId: string) {
  return { sessionId: sessionId as ClaudeSessionId, outputPath: "", finalText: "" };
}

function ok(stdout: string): ShellRunResult {
  return { exitCode: 0, stdout, stderr: "", stdoutEncoding: "utf8" };
}
