import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeStop } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { seedPaths, writeSeed } from "../../src/app/interactiveFiles.js";
import { runFirstTurn, type FirstTurnInput } from "../../src/app/interactiveStop.js";
import { exitCodeForError, EXIT_CODE_MEANINGS } from "../../src/cli/commands/runLayers.js";
import type { PhaseId, RunId } from "../../src/domain/branded.js";
import { AwaitingReviewStopError } from "../../src/domain/errors.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { reviewStop } from "../helpers/phaseStatusFixture.js";
import { createWorld, stopRun, type StoppedRun } from "../helpers/stoppedRunFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// A first turn through fake `claude` and `codex` executables and the real
// backend: the argv a read-only turn spawns, whatever the phase's policy.

const SESSION = "019a2f6e-0000-4000-8000-000000000001";

const reading = JSON.stringify({
  $schema: currentSchemaUrl("first-reading"),
  pattern: ["The InvoiceRow column order"],
  copiedBy: [{ phase: "phase-04", what: "the column order" }],
  toCheck: [],
});

let root: string;
let worktree: string;
let runPath: string;
let phaseFolder: string;
let cli: FakeProviderCli;

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: worktree, stdio: "pipe" }).toString();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-declared-stop-argv-test-")));
  worktree = join(root, "worktree");
  runPath = join(root, "runs", "invoice-export");
  phaseFolder = join(runPath, "phase-03");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(phaseFolder, { recursive: true });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(worktree);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(worktree, ".gitignore"), ".phax-context/\n");
  writeFileSync(join(worktree, "invoiceRow.ts"), "export const header = 'invoice_no';\n");
  git("add", "-A");
  git("commit", "-m", "base");

  cli = makeFakeProviderCli(root);
  for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(root);
});

// A secure phase posture with writable roots and an open network: none of it
// may reach a read-only turn's argv.
function policy(): SecurityPolicy {
  return {
    mode: "secure",
    filesystem: { allowRead: [worktree], allowWrite: [worktree, join(root, "home", ".phax")] },
    network: { profile: "open" },
    mcp: { mode: "allowlist", allow: ["docs"] },
    agentCommands: ["pnpm test"],
    failClosed: true,
  };
}

function providerConfig(): ProviderConfig {
  return {
    providers: {
      "claude-code": { enabled: true, executable: "claude" },
      "codex-cli": {
        enabled: true,
        executable: cli.codexPath,
        families: {
          "openai-gpt": {
            models: [{ id: "gpt-6-luna", efforts: ["low", "medium", "high"], status: "active" }],
          },
        },
      },
    },
  };
}

async function firstTurn(overrides: Partial<FirstTurnInput>) {
  const input: FirstTurnInput = {
    runId: "invoice-export-1792667922832" as RunId,
    runPath,
    phaseFolder,
    worktree,
    phase: { id: "phase-03" },
    provider: "claude-code",
    model: "claude-sonnet-5-5",
    effort: "medium",
    policy: policy(),
    origin: "first-turn",
    ...overrides,
  };
  const program = Effect.gen(function* () {
    yield* writeSeed(seedPaths(worktree, phaseFolder), "# Interactive review: phase-03\n");
    return yield* runFirstTurn(input);
  });
  return Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          makeNodeBackendLayer(providerConfig()),
          NodeFileSystemLayer,
          NodeGitLayer,
          NoopSystemTelemetryLayer,
        ),
      ),
    ),
  );
}

describe("a read-only first turn on Claude Code", () => {
  it("spawns claude with its reading tools only, no shell and no posture flag", async () => {
    cli.setScript({ sessionId: SESSION, finalText: reading });
    const result = await firstTurn({});

    const [call, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(call).toEqual({
      executable: "claude",
      cwd: worktree,
      argv: [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "default",
        "--tools",
        "Read,Grep,Glob",
        "--strict-mcp-config",
        "--model",
        "claude-sonnet-5-5",
        "--effort",
        "medium",
      ],
    });
    expect(result.turn).toMatchObject({ outcome: "answered", sessionId: SESSION });
    expect(result.session.current?.sessionId).toBe(SESSION);
    expect(readFileSync(join(phaseFolder, "first-turn-01.jsonl"), "utf8")).toContain(
      `"session_id":"${SESSION}"`,
    );
  });

  it("refuses and restores a turn whose CLI wrote in the worktree", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: reading,
      writeFile: { path: "invoiceRow.ts", content: "export const header = 'oops';\n" },
    });
    const result = await firstTurn({});
    expect(result.turn).toMatchObject({
      outcome: "refused-change",
      changedPaths: ["invoiceRow.ts"],
    });
    expect(result.session.current).toBeNull();
    expect(readFileSync(join(worktree, "invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'invoice_no';\n",
    );
    expect(git("status", "--porcelain")).toBe("");
  });
});

describe("a read-only first turn on codex", () => {
  it("spawns codex exec under the read-only sandbox, with no writable root or network override", async () => {
    cli.setScript({ sessionId: SESSION, finalText: reading });
    const result = await firstTurn({ provider: "codex-cli", model: "gpt-6" });

    const [call, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(call).toEqual({
      executable: "codex",
      cwd: worktree,
      argv: [
        "exec",
        "-C",
        worktree,
        "--json",
        "--skip-git-repo-check",
        "-c",
        `sandbox_mode="read-only"`,
        "-c",
        `approval_policy="never"`,
        "-m",
        "gpt-6-luna",
        "-c",
        `model_reasoning_effort="medium"`,
      ],
    });
    const argv = call!.argv.join(" ");
    expect(argv).not.toContain("writable_roots");
    expect(argv).not.toContain("network_access");
    expect(result.turn).toMatchObject({ outcome: "answered", sessionId: SESSION });
  });

  it("records a rate limit as a failed turn", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "", rateLimit: true });
    const result = await firstTurn({ provider: "codex-cli", model: "gpt-6" });
    expect(result.turn).toMatchObject({ outcome: "failed", reason: "rate-limit" });
    expect(result.session.current).toBeNull();
  });
});

// A closing turn: the made-up invoice-export run stopped at phase-03 (its
// first turn played by the fake backend), corrected, then closed through the
// real backend and the fake CLIs. The gate is a real, passing git command.

const handoffAnswer = JSON.stringify({
  $schema: currentSchemaUrl("interactive-handoff"),
  corrections: [
    {
      what: "The invoice header reads `Invoice number`",
      guard: { kind: "none", reason: "a one-word label" },
    },
  ],
  patternFromNowOn: [],
  nextPhasesNeedToKnow: [],
});

async function closeThroughCli(run: StoppedRun) {
  writeFileSync(
    join(run.worktree, "src", "invoiceRow.ts"),
    "export const header = 'Invoice number';\n",
  );
  const program = Effect.gen(function* () {
    yield* dispatch(
      {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        run: run.shortName as unknown as RunId,
        phase: "phase-03" as PhaseId,
        type: "RunResumeRequested",
      },
      {
        runPath: run.runPath,
        shortName: run.shortName,
        phaseFolderPath: run.phaseFolder,
        phaseId: "phase-03",
      },
    );
    return yield* closeStop({
      runId: run.runId as RunId,
      shortName: run.shortName,
      runPath: run.runPath,
      phase: {
        id: "phase-03",
        title: "Review the export record",
        model: "claude-sonnet-5-5",
        effort: "medium",
        planMarkdownAnchor: "#phase-03",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        mode: "interactive",
        oracle: null,
        commit: { subject: "feat(export): review the export record", body: "Made-up body." },
      },
      phaseFolder: run.phaseFolder,
      worktree: run.worktree,
      gateSteps: [
        { command: "git status", surface: "local", firing: "every-phase", output: "log" },
      ],
      gateRequest: Effect.succeed("{}"),
      fileReconciliationMode: "report_only",
    });
  });
  return Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          makeNodeBackendLayer(providerConfig()),
          NodeFileSystemLayer,
          NodeGitLayer,
          NodeShellLayer,
          NoopSystemTelemetryLayer,
        ),
      ),
    ),
  );
}

describe("a read-only closing turn through the provider CLIs", () => {
  it("resumes the claude session with its reading tools only, the phase's model and effort", async () => {
    const world = createWorld();
    try {
      const run = await stopRun(world, { sessionId: SESSION });
      cli.setScript({ sessionId: SESSION, finalText: handoffAnswer });

      const report = await closeThroughCli(run);

      const [call, ...more] = cli.invocations();
      expect(more).toEqual([]);
      expect(call).toEqual({
        executable: "claude",
        cwd: run.worktree,
        argv: [
          "--print",
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "default",
          "--tools",
          "Read,Grep,Glob",
          "--strict-mcp-config",
          "--model",
          "claude-sonnet-5-5",
          "--effort",
          "medium",
          "--resume",
          SESSION,
        ],
      });
      expect(report).toMatchObject({ outcome: "corrected", handoffSource: "closing-turn-resumed" });
      expect(readFileSync(join(run.phaseFolder, "closing-turn-01.jsonl"), "utf8")).toContain(
        `"session_id":"${SESSION}"`,
      );
    } finally {
      world.cleanup();
    }
  });

  it("resumes the codex session under the read-only sandbox, with the phase's model and effort", async () => {
    const world = createWorld();
    try {
      const run = await stopRun(world, {
        provider: "codex-cli",
        model: "gpt-6",
        sessionId: SESSION,
      });
      cli.setScript({ sessionId: SESSION, finalText: handoffAnswer });

      const report = await closeThroughCli(run);

      const [call, ...more] = cli.invocations();
      expect(more).toEqual([]);
      expect(call).toEqual({
        executable: "codex",
        cwd: run.worktree,
        argv: [
          "exec",
          "resume",
          SESSION,
          "--json",
          "--skip-git-repo-check",
          "-c",
          `sandbox_mode="read-only"`,
          "-c",
          `approval_policy="never"`,
          "-m",
          "gpt-6-luna",
          "-c",
          `model_reasoning_effort="medium"`,
        ],
      });
      expect(call!.argv.join(" ")).not.toContain("writable_roots");
      expect(report).toMatchObject({ outcome: "corrected", handoffSource: "closing-turn-resumed" });
    } finally {
      world.cleanup();
    }
  });
});

describe("exit code 13", () => {
  it("maps a stop to 13 and names it in the exit table", () => {
    const error = new AwaitingReviewStopError({
      message: "Awaiting review at phase-03",
      run: "invoice-export",
      phase: "phase-03",
      report: {
        cause: "declared",
        reviewStop: reviewStop(),
        reviewStopPath: "/example/runs/invoice-export/review-stop.json",
        firstReading: null,
        firstTurnProblem: null,
        unverifiedProvider: false,
      },
    });
    expect(exitCodeForError(error)).toBe(13);
    expect(EXIT_CODE_MEANINGS).toContainEqual({
      code: 13,
      meaning: "Awaiting review at an interactive phase (resumable)",
    });
  });
});
