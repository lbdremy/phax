import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeStop } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { resetPhase, ResetPhaseError } from "../../src/app/resetPhase.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { renderStopClosed } from "../../src/cli/commands/stopOutput.js";
import { decodeShortName, type PhaseId, type RunId } from "../../src/domain/branded.js";
import {
  AwaitingReviewStopError,
  GateAttemptsExhaustedError,
  StopCloseRefusedError,
} from "../../src/domain/errors.js";
import { oracleFindings } from "../../src/domain/plan/oracleCheck.js";
import { readPhaseHeaders } from "../../src/domain/plan/phaseHeader.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend } from "../../src/ports/backend.js";
import { Git, GitError } from "../../src/ports/git.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { RunHold } from "../../src/schemas/status.js";
import {
  NAMESPACE,
  SHORT,
  backendCalls,
  createHeldWorld,
  gitIn,
  readJson,
  readPhaseStatus,
  readRunStatus,
  resumeHeldRun,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";

// Reviews inside an oracle pair, on made-up invoice-export plans whose
// phase-02 pins tests/export/invoiceRow.test.ts: a held oracle phase, a
// declared review between the pair, and a held discharge. The real run loop
// and the real close on a temporary repository, with real git. The oracles
// provider is `./fake-oracles`, a made-up script committed in that
// repository: it records every request it reads, and answers a checked
// report with no finding, or with one when told to fail a verdict.

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
// No test reads ~/.phax: the routing and providers.json are the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/loadRouting.js")>()),
  loadModelRouting: () => Effect.succeed(DEFAULT_MODEL_ROUTING),
  loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
}));
// The journal would write under ~/.phax: telemetry is off in these tests.
vi.mock("../../src/cli/commands/runLayers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cli/commands/runLayers.js")>();
  const { NoopSystemTelemetryLayer: noop } = await import("../../src/ports/systemTelemetry.js");
  return { ...original, makeGlobalTelemetryJournalLayerOrNoop: () => noop };
});

const ORACLES = { command: "./fake-oracles" } as const;
const ORACLE_FILE = "tests/export/invoiceRow.test.ts";
const PORT_ORACLE_FILE = "tests/export/port.test.ts";
const SOURCE = "src/export/invoiceRow.ts";

const AUTHORED_TEST = "it('totals a row', () => expect(invoiceRow(row).total).toBe(120));\n";
const CORRECTED_TEST = "it('totals a row', () => expect(invoiceRow(row).total).toBe(100));\n";
const CORRECTED_SOURCE = "export const invoiceRow = (row) => ({ total: row.net });\n";

const reportUrl = currentSchemaUrl("gate-report");
const PASSING = JSON.stringify({
  $schema: reportUrl,
  outcome: "checked",
  findings: [],
  review: [],
});
const FAILING = JSON.stringify({
  $schema: reportUrl,
  outcome: "checked",
  findings: [
    {
      id: "oracle-total tests/export/invoiceRow.test.ts",
      rule: "an oracle pins the specified total",
      location: { file: ORACLE_FILE, lines: [1, 1] },
      message: "the invoice test pins the wrong total",
      related: [],
      guide: null,
    },
  ],
  review: [],
});

// ── The plans ──────────────────────────────────────────────────────────────

interface PhaseSpec {
  readonly title: string;
  readonly dischargedBy?: string;
  readonly oracleFiles?: readonly string[];
  readonly interactive?: boolean;
  readonly create?: readonly string[];
  readonly edit?: readonly string[];
  readonly optional?: readonly string[];
}

const idOf = (index: number): string => `phase-${String(index + 1).padStart(2, "0")}`;

function planOf(specs: readonly PhaseSpec[]): { plan: PhaxPlan; planMd: string } {
  const phases = specs.map(
    (spec, i): PhaxPlanPhase => ({
      id: idOf(i),
      title: spec.title,
      model: "claude-sonnet-5-5",
      effort: "medium",
      planMarkdownAnchor: `#${idOf(i)}`,
      plannedFilesToCreate: spec.create ?? (spec.interactive === true ? [] : [`src/${idOf(i)}.ts`]),
      plannedFilesToEdit: spec.edit ?? [],
      optionalFilesToEdit: spec.optional ?? [],
      mode: spec.interactive === true ? "interactive" : "headless",
      oracle:
        spec.dischargedBy === undefined
          ? null
          : { dischargedBy: spec.dischargedBy, files: spec.oracleFiles ?? [ORACLE_FILE] },
      commit: { subject: `feat(export): ${spec.title.toLowerCase()}`, body: "Made-up body." },
    }),
  );
  const plan = {
    run: {
      shortName: SHORT,
      title: "Invoice export",
      branch: `phax/${SHORT}`,
      requiredCommands: [],
    },
    phases,
  } as unknown as PhaxPlan;
  const planMd = [
    "# Invoice export",
    "",
    "## Required commands",
    "",
    "- (none)",
    "",
    ...phases.flatMap((phase) => [
      `## ${phase.id} — ${phase.title} {#${phase.id}}`,
      "",
      `**Recommended model:** ${phase.model}`,
      `**Recommended effort:** ${phase.effort}`,
      ...(phase.mode === "interactive" ? ["**Mode:** interactive"] : []),
      ...(phase.oracle === null
        ? []
        : [
            `**Oracle phase:** discharged by ${phase.oracle.dischargedBy}`,
            `**Oracle files:** ${phase.oracle.files.map((f) => `\`${f}\``).join(", ")}`,
          ]),
      "",
      "### Detailed instructions",
      "",
      `Carry out ${phase.id}'s made-up instructions.`,
      "",
    ]),
  ].join("\n");
  return { plan, planMd };
}

// The four-phase variant: phase-02 pins the invoice test, phase-03 discharges it.
const FOUR_PHASES = planOf([
  { title: "Export port" },
  { title: "Invoice CSV record", dischargedBy: "phase-03", create: [ORACLE_FILE, SOURCE] },
  { title: "Invoice totals", edit: [SOURCE] },
  { title: "Export command" },
]);

// The five-phase variant: declared phase-03 reviews the pair phase-04 discharges.
const FIVE_PHASES = planOf([
  { title: "Export port" },
  { title: "Invoice CSV record", dischargedBy: "phase-04", create: [ORACLE_FILE, SOURCE] },
  { title: "Review the invoice tests", interactive: true, optional: [ORACLE_FILE, SOURCE] },
  { title: "Invoice totals", edit: [SOURCE] },
  { title: "Export command" },
]);

// Two overlapping pairs: phase-01 pins the port test until phase-04, phase-02
// the invoice test until phase-03.
const TWO_PAIRS = planOf([
  {
    title: "Export port",
    dischargedBy: "phase-04",
    oracleFiles: [PORT_ORACLE_FILE],
    create: [PORT_ORACLE_FILE, "src/phase-01.ts"],
  },
  { title: "Invoice CSV record", dischargedBy: "phase-03", create: [ORACLE_FILE, SOURCE] },
  { title: "Invoice totals", edit: [SOURCE] },
  { title: "Port totals", edit: ["src/phase-01.ts"] },
  { title: "Export command" },
]);

// ── The world ──────────────────────────────────────────────────────────────

let world: HeldWorld;

const requestsDir = (): string => join(world.root, "oracle-requests");
const failFlag = (): string => join(world.root, "oracles-fail");

/** Commit the made-up `./fake-oracles` provider into the world's repository. */
function installFakeOracles(w: HeldWorld): void {
  const script = [
    "#!/bin/sh",
    "# The made-up oracles provider: records each request it reads, and answers",
    "# a checked report, with a finding when told to fail the request's verdict.",
    `dir='${join(w.root, "oracle-requests")}'`,
    'mkdir -p "$dir"',
    'n=$(ls "$dir" | wc -l | tr -d " ")',
    'file="$dir/$(printf "%03d" $((n + 1))).json"',
    'cat > "$file"',
    `flag='${join(w.root, "oracles-fail")}'`,
    'if [ -e "$flag" ] && grep -q "\\"verdict\\": \\"$(cat "$flag")\\"" "$file"; then',
    `  printf '%s' '${FAILING}'`,
    "else",
    `  printf '%s' '${PASSING}'`,
    "fi",
    "",
  ].join("\n");
  const path = join(w.repoRoot, "fake-oracles");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  gitIn(w.repoRoot, "add", "fake-oracles");
  gitIn(w.repoRoot, "commit", "-m", "chore: fake oracles");
}

/** Every request the provider read, in order. */
function requests(): Record<string, unknown>[] {
  if (!existsSync(requestsDir())) return [];
  return readdirSync(requestsDir())
    .toSorted()
    .map((name) => readJson(join(requestsDir(), name)));
}

const verdicts = (): string[] =>
  requests().map((r) => `${String(r["verdict"])}:${String(r["phase"])}`);

/** The made-up builder: phase-01 and phase-02 write their oracle files and phase-02 its source. */
function build(phase: string, worktree: string): void {
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(worktree, path)), { recursive: true });
    writeFileSync(join(worktree, path), content);
  };
  if (phase === "phase-01") write(PORT_ORACLE_FILE, "it('opens the port', () => {});\n");
  if (phase === "phase-02") {
    write(ORACLE_FILE, AUTHORED_TEST);
    write(SOURCE, "export const invoiceRow = (row) => ({ total: row.gross });\n");
  }
}

async function startStopped(
  plan: { plan: PhaxPlan; planMd: string },
  hold: RunHold,
): Promise<HeldRun> {
  const { run, result } = await startHeldRun(world, hold, {
    plan,
    oracles: ORACLES,
    prepare: (r) => {
      r.backend.onBuild = build;
    },
  });
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(AwaitingReviewStopError);
  return run;
}

const tree = (run: HeldRun, phaseId: string): string => worktreeOf(run, phaseId);
const headOf = (run: HeldRun, phaseId: string): string =>
  gitIn(tree(run, phaseId), "rev-parse", "HEAD");
const writeIn = (run: HeldRun, phaseId: string, path: string, content: string): void =>
  writeFileSync(join(tree(run, phaseId), path), content);

function refusedClose(result: Either.Either<unknown, unknown>): StopCloseRefusedError {
  if (Either.isRight(result)) throw new Error("the close was not refused");
  expect(result.left).toBeInstanceOf(StopCloseRefusedError);
  return result.left as StopCloseRefusedError;
}

const oracleRequestSchema = expect.stringMatching(
  /\/schemas\/oracle-request\/\d+\.\d+\.\d+\.json$/,
);

beforeEach(() => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
  installFakeOracles(world);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
});

// ── A held oracle phase ────────────────────────────────────────────────────

const HOLD_ORACLE: RunHold = { selection: "oracle", phases: ["phase-02"] };

describe("a held oracle phase", { timeout: 60_000 }, () => {
  it("is judged again when its review changes an oracle file, and the discharge judges the review commit", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_ORACLE);
    const c2 = headOf(run, "phase-02");
    expect(verdicts()).toEqual(["authored:phase-02"]);

    writeIn(run, "phase-02", ORACLE_FILE, CORRECTED_TEST);
    const result = await resumeHeldRun(run);

    expect(Either.isRight(result)).toBe(true);
    const phase01 = readPhaseStatus(run, "phase-01");
    const phase02 = readPhaseStatus(run, "phase-02");
    expect(phase02["base"]).toBe(phase01["commitHash"]);
    const [, closing, discharged] = requests();
    expect(closing).toEqual({
      $schema: oracleRequestSchema,
      verdict: "authored",
      phase: "phase-02",
      oraclePhase: "phase-02",
      base: phase01["commitHash"],
      files: [ORACLE_FILE],
    });
    expect(phase02).toMatchObject({
      state: "cleaned_up",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "corrected", oracleStep: "authored" },
    });
    const reviewCommit = (phase02["stop"] as { reviewCommit: string }).reviewCommit;
    expect(gitIn(tree(run, "phase-02"), "rev-parse", `${reviewCommit}^`)).toBe(c2);
    expect(discharged).toMatchObject({
      verdict: "discharged",
      phase: "phase-03",
      oraclePhase: "phase-02",
      oracleCommit: reviewCommit,
    });
    expect(requests()).toHaveLength(3);
    // The closing gate's attribution ends with the oracle step, under review-gate/.
    const attribution = readJson(
      join(run.runPath, "phase-02", "review-gate", "gate-attribution.json"),
    );
    expect((attribution["steps"] as unknown[]).at(-1)).toEqual({
      command: ORACLES.command,
      surface: "oracle",
      result: "pass",
    });
    expect(run.closed[0]?.report).toMatchObject({ cause: "held", oracleStep: "authored" });
  });

  it("sends no request at closing when the review changes only the source, and the discharge judges C2", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_ORACLE);
    const c2 = headOf(run, "phase-02");

    writeIn(run, "phase-02", SOURCE, CORRECTED_SOURCE);
    const result = await resumeHeldRun(run);

    expect(Either.isRight(result)).toBe(true);
    expect(verdicts()).toEqual(["authored:phase-02", "discharged:phase-03"]);
    expect(requests()[1]?.["oracleCommit"]).toBe(c2);
    expect(readPhaseStatus(run, "phase-02")["stop"]).toMatchObject({
      outcome: "corrected",
      oracleStep: "none",
    });
  });

  it("keeps the stop on a failing authored verdict: exit 4", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_ORACLE);
    const c2 = headOf(run, "phase-02");
    writeIn(run, "phase-02", ORACLE_FILE, CORRECTED_TEST);
    writeFileSync(failFlag(), "authored");

    const error = refusedClose(await resumeHeldRun(run));

    expect(exitCodeForError(error)).toBe(4);
    expect(error.lastClose).toMatchObject({ result: "gate-failed", exitCode: 4 });
    expect(verdicts()).toEqual(["authored:phase-02", "authored:phase-02"]);
    expect(readRunStatus(run)["state"]).toBe("awaiting_review");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "awaiting_review",
      stop: { cause: "held", status: "waiting" },
    });
    expect(headOf(run, "phase-02")).toBe(c2);
    expect(existsSync(join(run.runPath, "phase-03"))).toBe(false);
  });

  it("refuses corrections that touch two pairs' oracle files, sending no request", async () => {
    const run = await startStopped(TWO_PAIRS, { selection: "listed", phases: ["phase-02"] });
    writeIn(run, "phase-02", ORACLE_FILE, CORRECTED_TEST);
    writeIn(run, "phase-02", PORT_ORACLE_FILE, "it('opens the port twice', () => {});\n");

    const error = refusedClose(await resumeHeldRun(run));

    expect(exitCodeForError(error)).toBe(1);
    expect(error.lastClose).toMatchObject({ result: "close-error", step: "gate" });
    const detail = (error.lastClose as { detail: string }).detail;
    expect(detail).toContain("phase-01 → phase-04");
    expect(detail).toContain("phase-02 → phase-03");
    expect(verdicts()).toEqual(["authored:phase-01", "authored:phase-02"]);
    expect(readPhaseStatus(run, "phase-02")["state"]).toBe("awaiting_review");
  });

  it("refuses a gate step that writes an oracle file, naming the file", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_ORACLE);
    // A gate step, outside the worktree, that appends to the oracle file.
    const step = join(world.root, "write-oracle");
    writeFileSync(step, `#!/bin/sh\nprintf 'extra\\n' >> ${ORACLE_FILE}\n`);
    chmodSync(step, 0o755);
    const profiles = run.config.raw.gateProfiles as unknown as Record<string, unknown[]>;
    profiles["standard"] = [
      ...profiles["standard"]!,
      { command: step, surface: "local", firing: "every-phase", output: "log" },
    ];
    writeIn(run, "phase-02", SOURCE, CORRECTED_SOURCE);

    const error = refusedClose(await resumeHeldRun(run));

    expect(error.lastClose).toMatchObject({ result: "close-error", exitCode: 1, step: "gate" });
    expect((error.lastClose as { detail: string }).detail).toContain(
      `a gate step wrote ${ORACLE_FILE}, an oracle file of pair phase-02 → phase-03`,
    );
    expect(verdicts()).toEqual(["authored:phase-02"]);
  });
});

// ── A declared review between the pair ─────────────────────────────────────

describe("a declared review between the pair", { timeout: 60_000 }, () => {
  it("lints clean, is judged again at its close, and moves the oracle commit", async () => {
    expect(
      oracleFindings({
        headers: readPhaseHeaders(FIVE_PHASES.planMd),
        phases: FIVE_PHASES.plan.phases,
        providerConfigured: true,
      }),
    ).toEqual([]);
    const run = await startStopped(FIVE_PHASES, { selection: "none" });
    expect(readPhaseStatus(run, "phase-03")["state"]).toBe("awaiting_review");

    writeIn(run, "phase-03", ORACLE_FILE, CORRECTED_TEST);
    const result = await resumeHeldRun(run);

    expect(Either.isRight(result)).toBe(true);
    const phase02 = readPhaseStatus(run, "phase-02");
    const phase03 = readPhaseStatus(run, "phase-03");
    expect(verdicts()).toEqual(["authored:phase-02", "authored:phase-03", "discharged:phase-04"]);
    expect(requests()[1]).toEqual({
      $schema: oracleRequestSchema,
      verdict: "authored",
      phase: "phase-03",
      oraclePhase: "phase-02",
      base: phase02["base"],
      files: [ORACLE_FILE],
    });
    expect(phase03["stop"]).toEqual({
      cause: "declared",
      status: "closed",
      outcome: "corrected",
      oracleStep: "authored",
    });
    expect(requests()[2]?.["oracleCommit"]).toBe(phase03["commitHash"]);
    expect(phase03["commitHash"]).not.toBe(phase02["commitHash"]);
  });

  it("is not reset once its discharge has started", async () => {
    const run = await startStopped(FIVE_PHASES, { selection: "none" });
    writeIn(run, "phase-03", ORACLE_FILE, CORRECTED_TEST);
    writeFileSync(failFlag(), "discharged");
    const result = await resumeHeldRun(run);
    if (Either.isRight(result)) throw new Error("expected the discharge to fail");
    expect(result.left).toBeInstanceOf(GateAttemptsExhaustedError);
    const before = readFileSync(join(run.runPath, "phase-03", "status.json"), "utf8");

    const reset = await Effect.runPromise(
      Effect.either(
        resetPhase({
          namespace: NAMESPACE,
          shortName: Either.getOrThrow(decodeShortName(SHORT)),
          phaseId: "phase-03",
          stateRoot: world.stateRoot,
          repoRoot: world.repoRoot,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeFileSystemLayer,
              NodeGitLayer,
              NodeShellLayer,
              makeFakeLock().layer,
              NoopSystemTelemetryLayer,
            ),
          ),
        ),
      ),
    );

    if (Either.isRight(reset)) throw new Error("expected the reset to be refused");
    expect(reset.left).toBeInstanceOf(ResetPhaseError);
    const state = String(readPhaseStatus(run, "phase-04")["state"]);
    expect(state).toBe("gates_exhausted");
    // The discharge stopped at its gate: the refusal names the recovery.
    expect(reset.left.message).toBe(
      `Cannot reset 'phase-03' of run '${SHORT}': its discharging phase 'phase-04' is ${state}, and the discharge judges this phase's commit. To correct the oracle, edit it in phase-04 (\`phax enter-phase ${SHORT} phase-04\`), then run \`phax resume ${SHORT} --yes --skip-oracle\`: the configured gate still runs.`,
    );
    expect(readFileSync(join(run.runPath, "phase-03", "status.json"), "utf8")).toBe(before);
  });
});

// ── A held discharge ───────────────────────────────────────────────────────

const HOLD_DISCHARGE: RunHold = { selection: "listed", phases: ["phase-03"] };

describe("a held discharge closes on its configured steps", { timeout: 60_000 }, () => {
  it("closes unchanged with no request", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_DISCHARGE);
    expect(verdicts()).toEqual(["authored:phase-02", "discharged:phase-03"]);

    const result = await resumeHeldRun(run);

    expect(Either.isRight(result)).toBe(true);
    expect(verdicts()).toEqual(["authored:phase-02", "discharged:phase-03"]);
    expect(run.closed[0]?.report).toMatchObject({
      cause: "held",
      outcome: "unchanged",
      oracleStep: "none",
    });
  });

  it("commits an oracle-file change with no request, warning about it and tracing it", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_DISCHARGE);
    const c3 = headOf(run, "phase-03");

    writeIn(run, "phase-03", ORACLE_FILE, CORRECTED_TEST);
    const result = await resumeHeldRun(run);

    expect(Either.isRight(result)).toBe(true);
    expect(verdicts()).toEqual(["authored:phase-02", "discharged:phase-03"]);
    const closed = run.closed[0]!;
    expect(closed.report).toMatchObject({
      cause: "held",
      outcome: "corrected",
      phaseCommit: c3,
      oracleStep: "none",
      unjudgedOracleFiles: [ORACLE_FILE],
    });
    expect(closed.report.gateSteps.map((s) => s.surface)).toEqual(["local"]);
    expect(renderStopClosed(closed)).toContain(
      `  warning: ${ORACLE_FILE}: an oracle file changed at the discharge; the discharge was judged before the stop, so the oracles provider does not see this change`,
    );
    expect(run.telemetry.impl.events().filter((e) => e.type === "oracle.edits.unjudged")).toEqual([
      {
        type: "oracle.edits.unjudged",
        runId: run.runId,
        operationId: "phase-03",
        files: [ORACLE_FILE],
      },
    ]);
  });

  it("returns a correction that breaks a configured step: exit 4, no fix attempt, nothing committed", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_DISCHARGE);
    const c3 = headOf(run, "phase-03");
    const callsBefore = backendCalls(run, "phase-03").length;
    writeIn(run, "phase-03", ORACLE_FILE, CORRECTED_TEST);
    run.failingGates.add("pnpm typecheck");

    const error = refusedClose(await resumeHeldRun(run));

    expect(exitCodeForError(error)).toBe(4);
    expect(error.lastClose).toMatchObject({ result: "gate-failed" });
    expect(backendCalls(run, "phase-03")).toHaveLength(callsBefore);
    expect(headOf(run, "phase-03")).toBe(c3);
    expect(verdicts()).toEqual(["authored:phase-02", "discharged:phase-03"]);
  });
});

// ── A close finished from its landed commit ────────────────────────────────

describe("an authored close interrupted after its review commit", { timeout: 60_000 }, () => {
  const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));
  const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));

  // The first close: its gate runs the authored step and its review commit
  // lands, then writing the review diff fails.
  function closeThatFailsAfterItsCommit(run: HeldRun) {
    let committed = false;
    const git = Layer.succeed(Git, {
      ...realGit,
      commitTree: (...args: Parameters<typeof realGit.commitTree>) =>
        realGit.commitTree(...args).pipe(Effect.tap(() => Effect.sync(() => (committed = true)))),
      diffTrees: (...args: Parameters<typeof realGit.diffTrees>) =>
        committed
          ? Effect.fail(new GitError({ message: "disk full", command: "git diff-tree" }))
          : realGit.diffTrees(...args),
    });
    const shell = Layer.succeed(Shell, {
      run: (options) =>
        options.command[0] === "pnpm"
          ? Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const })
          : realShell.run(options),
    });
    const phase = run.plan.phases[1]!;
    const phaseFolder = join(run.runPath, "phase-02");
    return Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          yield* dispatch(
            {
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),
              run: SHORT as unknown as RunId,
              phase: "phase-02" as PhaseId,
              type: "RunResumeRequested",
            },
            {
              runPath: run.runPath,
              shortName: SHORT,
              phaseFolderPath: phaseFolder,
              phaseId: "phase-02",
            },
          );
          return yield* closeStop({
            runId: run.runId,
            shortName: SHORT,
            runPath: run.runPath,
            phase,
            phaseFolder,
            worktree: tree(run, "phase-02"),
            gateSteps: run.config.raw.gateProfiles["standard"]!,
            gateRequest: Effect.succeed("{}"),
            fileReconciliationMode: "report_only",
            phases: run.plan.phases,
            oracles: ORACLES,
          });
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Backend, run.backend),
              NodeFileSystemLayer,
              git,
              shell,
              NoopSystemTelemetryLayer,
            ),
          ),
        ),
      ),
    );
  }

  it("is finished by the next close, which still reports authored, and the discharge names that commit", async () => {
    const run = await startStopped(FOUR_PHASES, HOLD_ORACLE);
    const c2 = headOf(run, "phase-02");
    writeIn(run, "phase-02", ORACLE_FILE, CORRECTED_TEST);

    const first = refusedClose(await closeThatFailsAfterItsCommit(run));
    expect(first.lastClose).toMatchObject({ result: "close-error", step: "files" });
    const landed = headOf(run, "phase-02");
    expect(landed).not.toBe(c2);
    expect(verdicts()).toEqual(["authored:phase-02", "authored:phase-02"]);

    const result = await resumeHeldRun(run);

    expect(Either.isRight(result)).toBe(true);
    expect(run.closed[0]?.report).toMatchObject({
      cause: "held",
      handoffSource: "earlier-close",
      reviewCommit: landed,
      oracleStep: "authored",
    });
    expect(readPhaseStatus(run, "phase-02")["stop"]).toEqual({
      cause: "held",
      status: "closed",
      outcome: "corrected",
      reviewCommit: landed,
      oracleStep: "authored",
    });
    // No request at the finishing close: its gate ran before the commit.
    expect(verdicts()).toEqual(["authored:phase-02", "authored:phase-02", "discharged:phase-03"]);
    expect(requests()[2]?.["oracleCommit"]).toBe(landed);
  });
});
