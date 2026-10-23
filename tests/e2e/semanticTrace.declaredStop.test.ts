/**
 * Doctrine §15 — proof-preserving iteration, for a declared interactive stop.
 *
 * This test drives a three-phase plan whose phase-02 is declared interactive
 * end to end: `phax run` stops at phase-02 after its read-only first turn, the
 * person corrects the worktree, and `phax resume` closes the stop and runs
 * phase-03 to review. It snapshots the SemanticTraceSnapshot projection of
 * each invocation. Future refactors that alter either event sequence must
 * update these baselines intentionally with `--update-snapshot`. See
 * docs/observability.md for the doctrine.
 *
 * Real git on a temporary repository and the real file system; the provider
 * turns are played by a fake backend, so no real `claude` binary is required.
 *
 * Gate: set PHAX_E2E_RUN=1 to run.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { withRunLock } from "../../src/app/lock.js";
import { inspectResumeOnDisk } from "../helpers/inspectResume.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId, type RunId } from "../../src/domain/branded.js";
import { AgentInvocationError, AwaitingReviewStopError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend, type AgentRunOptions, type BackendOps } from "../../src/ports/backend.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import { withTelemetryCapture } from "./helpers/telemetry.js";

const UNSTABLE_FIELD_NAMES = ["timestamp", "traceId", "spanId", "durationMs"] as const;

const shouldRun = process.env["PHAX_E2E_RUN"] === "1";

const NAMESPACE = "example";
const SHORT = "ledger-formatters";
const SESSION_FIRST_TURN = "019a2f6e-0000-4000-8000-000000000002";

const FIRST_READING = JSON.stringify({
  $schema: currentSchemaUrl("first-reading"),
  pattern: ["formatEuro(cents) returns `<amount> EUR`"],
  copiedBy: [{ phase: "phase-03", what: "the formatter's name, signature and output shape" }],
  toCheck: ["How negative amounts format"],
});

const CLOSING_ANSWER = JSON.stringify({
  $schema: currentSchemaUrl("interactive-handoff"),
  corrections: [
    {
      what: "formatEuro rejects non-integer cents",
      guard: { kind: "none", reason: "No test runs in this made-up plan." },
    },
  ],
  patternFromNowOn: ["Formatters reject non-integer cents"],
  nextPhasesNeedToKnow: ["phase-03 copies the corrected formatter"],
});

const CORRECTED_EURO =
  "export const formatEuro = (cents: number): string => {\n" +
  "  if (!Number.isInteger(cents)) throw new RangeError('cents');\n" +
  "  return `${(cents / 100).toFixed(2)} EUR`;\n" +
  "};\n";

const handoffOf = (phaseId: string): string =>
  [
    "## What was delivered",
    `- ${phaseId} delivered its file.`,
    "## Key decisions and why",
    "- None.",
    "## Exact locations (file paths and exported names)",
    `- src/${phaseId}.ts`,
    "## What the next phase needs to know",
    "- Ready to proceed.",
    "",
  ].join("\n");

const SPECS = [
  { title: "Euro formatter", interactive: false },
  { title: "Review the euro formatter", interactive: true },
  { title: "Dollar formatter", interactive: false },
] as const;

const idOf = (index: number): string => `phase-${String(index + 1).padStart(2, "0")}`;

function planOf(): { plan: PhaxPlan; planMd: string } {
  const plan = {
    run: {
      shortName: SHORT,
      title: "Ledger formatters",
      branch: `phax/${SHORT}`,
      requiredCommands: [],
    },
    phases: SPECS.map(
      (spec, i): PhaxPlanPhase => ({
        id: idOf(i),
        title: spec.title,
        model: "claude-sonnet-5-5",
        effort: "medium",
        planMarkdownAnchor: `#${idOf(i)}`,
        plannedFilesToCreate: spec.interactive ? [] : [`src/${idOf(i)}.ts`],
        plannedFilesToEdit: [],
        optionalFilesToEdit: spec.interactive ? ["src/phase-01.ts"] : [],
        mode: spec.interactive ? "interactive" : "headless",
        oracle: null,
        commit: { subject: `feat(ledger): ${spec.title.toLowerCase()}`, body: "Made-up body." },
      }),
    ) as unknown as PhaxPlan["phases"],
  } satisfies PhaxPlan;
  const planMd = [
    "# Ledger formatters",
    "",
    "## Required commands",
    "",
    "- (none)",
    "",
    ...plan.phases.flatMap((phase) => [
      `## ${phase.id} — ${phase.title} {#${phase.id}}`,
      "",
      `**Recommended model:** ${phase.model}`,
      `**Recommended effort:** ${phase.effort}`,
      ...(phase.mode === "interactive" ? ["**Mode:** interactive"] : []),
      "",
      "### Detailed instructions",
      "",
      phase.mode === "interactive" ? "Review src/phase-01.ts." : `Write src/${phase.id}.ts.`,
      "",
    ]),
  ].join("\n");
  return { plan, planMd };
}

let root: string;
let repoRoot: string;
let stateRoot: string;

function configOf(): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: stateRoot },
      gateProfiles: {
        standard: [
          { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
        ],
      },
    },
    stateRoot,
    namespace: NAMESPACE,
    repoRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
  } as ResolvedConfig;
}

const unused = () => Effect.fail(new AgentInvocationError({ message: "not played by this test" }));

const stream = (options: AgentRunOptions): void => {
  if (options.outputJsonlPath !== undefined) writeFileSync(options.outputJsonlPath, "");
};

const phaseOf = (options: AgentRunOptions): string =>
  basename(options.phaseFolderPath ?? options.cwd);

// A headless phase writes its planned file, then its handoff when phax resumes
// it for one. A read-only turn answers a first reading on a run and a closing
// handoff on a resume.
const backend: BackendOps = {
  runAgent: (_prompt, options) => {
    if (options.readOnly === true) {
      stream(options);
      return Effect.succeed({
        sessionId: SESSION_FIRST_TURN as ClaudeSessionId,
        outputPath: "",
        finalText: FIRST_READING,
      });
    }
    const phase = phaseOf(options);
    return Effect.sync(() => {
      writeFileSync(
        join(options.cwd, "src", `${phase}.ts`),
        `export const ${phase.replace("-", "")} = 1;\n`,
      );
      return { sessionId: `sess-${phase}` as ClaudeSessionId, outputPath: "", finalText: "" };
    });
  },
  resumeAgentSession: (sessionId, _prompt, options) => {
    if (options.readOnly === true) {
      stream(options);
      return Effect.succeed({ sessionId, outputPath: "", finalText: CLOSING_ANSWER });
    }
    const phase = phaseOf(options);
    return Effect.sync(() => {
      writeFileSync(join(options.cwd, ".phax-context", "phase-handoff.md"), handoffOf(phase));
      return { sessionId, outputPath: "", finalText: "" };
    });
  },
  complete: unused,
  probe: unused,
};

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));

// The `pnpm typecheck` gate step passes without running; every other command runs.
const shell = Layer.succeed(Shell, {
  run: (options) =>
    options.command[0] === "pnpm"
      ? Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const })
      : realShell.run(options),
});

// The projection carries the temporary root and git object names, which change
// on every run: replace them so the baseline holds.
function stable(snapshot: unknown): unknown {
  const text = JSON.stringify(snapshot)
    .replaceAll(root, "<root>")
    .replace(/\b[0-9a-f]{40}\b/g, "<sha>");
  return JSON.parse(text);
}

function expectNoUnstableFields(snapshot: unknown): void {
  const serialized = JSON.stringify(snapshot);
  for (const field of UNSTABLE_FIELD_NAMES) {
    expect(serialized, `snapshot must not contain unstable field "${field}"`).not.toContain(
      `"${field}"`,
    );
  }
  expect(serialized, "snapshot must not contain raw Unix timestamps").not.toMatch(/\b\d{13,}\b/);
}

describe.skipIf(!shouldRun)("E2E semantic trace — declared interactive stop snapshot", () => {
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "phax-e2e-semantic-trace-stop-")));
    repoRoot = join(root, "repo");
    stateRoot = join(root, "state");
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(join(root, "home"), { recursive: true });
    vi.stubEnv("HOME", join(root, "home"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
    git("init", "--initial-branch=main");
    disableGitAutoMaintenance(repoRoot);
    git("config", "--local", "user.email", "ada@example.test");
    git("config", "--local", "user.name", "Ada Example");
    writeFileSync(join(repoRoot, ".gitignore"), ".phax-context/\n");
    writeFileSync(join(repoRoot, "src", "index.ts"), "export {};\n");
    git("add", "-A");
    git("commit", "-m", "chore: start");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeTempDir(root);
  });

  it("pins the trace of a run that stops at a declared phase, then of the resume that closes it", async () => {
    const shortName = Either.getOrThrow(decodeShortName(SHORT));
    const { plan, planMd } = planOf();
    const config = configOf();
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    const lock = makeFakeLock();

    const execute = (startIndex: number, runIdOf: RunId) => {
      const telemetry = withTelemetryCapture(NoopSystemTelemetryLayer);
      const program = withRunLock(
        `${NAMESPACE}.${SHORT}`,
        executePlan({
          shortName,
          namespace: NAMESPACE,
          plan,
          planMd,
          config,
          gateProfileId: "standard",
          allowDirty: false,
          runPath,
          runId: runIdOf,
          startIndex,
          routing: DEFAULT_MODEL_ROUTING,
          providerConfig: DEFAULT_PROVIDER_CONFIG,
        }),
      );
      const layers = Layer.mergeAll(
        Layer.succeed(Backend, backend),
        NodeFileSystemLayer,
        NodeGitLayer,
        shell,
        telemetry.layer,
        makeFakeGitHub().layer,
        lock.layer,
      );
      return Effect.runPromise(Effect.either(program.pipe(Effect.provide(layers)))).then(
        (result) => ({ result, snapshot: telemetry.impl.getSemanticTraceSnapshot() }),
      );
    };

    // phax run: phase-01 commits, phase-02 stops after its read-only first turn.
    const stopped = await execute(0, runId);
    expect(Either.isLeft(stopped.result) && stopped.result.left).toBeInstanceOf(
      AwaitingReviewStopError,
    );
    expectNoUnstableFields(stopped.snapshot);
    expect(stable(stopped.snapshot)).toMatchSnapshot("declared-stop-run-semantic-trace");

    // The person corrects the worktree; phax resume closes the stop and runs phase-03.
    writeFileSync(
      join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, "phase-02", "src", "phase-01.ts"),
      CORRECTED_EURO,
    );
    const decision = await inspectResumeOnDisk(NAMESPACE, shortName, stateRoot);
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    const closed = await execute(decision.right.nextPhaseIndex, runId);
    if (Either.isLeft(closed.result)) {
      throw new Error(`the resume failed: ${String(closed.result.left)}`);
    }
    expectNoUnstableFields(closed.snapshot);
    expect(stable(closed.snapshot)).toMatchSnapshot("declared-stop-resume-semantic-trace");
  });
});
