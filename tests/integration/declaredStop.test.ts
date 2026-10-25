import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readExecutedHandoffs,
  readReviewStop,
  refreshReviewStop,
} from "../../src/app/interactiveFiles.js";
import {
  detailedInstructionsOf,
  stopAtDeclaredPhase,
  type DeclaredStopInput,
} from "../../src/app/interactiveStop.js";
import type { ClaudeSessionId, RunId } from "../../src/domain/branded.js";
import type { DeclaredStopReport } from "../../src/domain/errors.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { InteractiveSession } from "../../src/schemas/interactiveSession.js";
import {
  currentSchemaUrl,
  readInteractiveSessionFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { parseSchemaUrl } from "../../src/schemas/schemaUrl.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { runStatus } from "../helpers/runStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The made-up invoice-export run stops at phase-03, which its plan declares
// interactive. Real git on a temporary repository, the real file system, and
// the fake backend playing the provider.

const SESSION = "4f6c1a52-0000-4000-8000-000000000001" as ClaudeSessionId;
const RELEASE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function planPhase(id: string, title: string, mode: "headless" | "interactive"): PhaxPlanPhase {
  return {
    id,
    title,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode,
    oracle: null,
    testLines: [],
    commit: { subject: `feat(export): ${title.toLowerCase()}`, body: "Made-up body." },
  };
}

const phases: readonly PhaxPlanPhase[] = [
  planPhase("phase-01", "Export port", "headless"),
  planPhase("phase-02", "Invoice CSV record", "headless"),
  planPhase("phase-03", "Review the export record", "interactive"),
  planPhase("phase-04", "Credit notes export", "headless"),
];

const DETAILED = "Review `InvoiceRow`: the header wording, the column order, the missing tax id.";

const planSections = new Map<string, string>([
  ["phase-01", "## phase-01 — Export port\n\nAdd the export port."],
  ["phase-02", "## phase-02 — Invoice CSV record\n\nWrite one CSV row per invoice."],
  [
    "phase-03",
    [
      "## phase-03 — Review the export record",
      "",
      "Intro line.",
      "",
      "### Detailed instructions",
      "",
      DETAILED,
      "",
      "### Verification",
      "",
      "The standard gate.",
    ].join("\n"),
  ],
  ["phase-04", "## phase-04 — Credit notes export\n\nCopy the invoice row for credit notes."],
]);

const reading = {
  $schema: currentSchemaUrl("first-reading"),
  pattern: ["The InvoiceRow column order", "The header wording `invoice_no`"],
  copiedBy: [{ phase: "phase-04", what: "the column order and the header wording" }],
  toCheck: ["Whether `invoice_no` should read `Invoice number`"],
};

let root: string;
let worktree: string;
let runPath: string;
let phaseFolder: string;

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: worktree, stdio: "pipe" }).toString();

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

function readSession(): InteractiveSession {
  const path = join(phaseFolder, "interactive-session.json");
  const decoded = readInteractiveSessionFile(path, readJson(path));
  if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
  return decoded.right;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-declared-stop-test-")));
  worktree = join(root, "worktrees", "invoice-export", "phase-03");
  runPath = join(root, "runs", "invoice-export");
  phaseFolder = join(runPath, "phase-03");
  mkdirSync(worktree, { recursive: true });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(worktree);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(worktree, ".gitignore"), ".phax-context/\n");
  mkdirSync(join(worktree, "src"));
  writeFileSync(join(worktree, "src", "invoiceRow.ts"), "export const header = 'invoice_no';\n");
  git("add", "-A");
  git("commit", "-m", "feat(export): invoice CSV record");
  mkdirSync(join(worktree, ".phax-context"));
  writeFileSync(join(worktree, ".phax-context", "plan.md"), "# Invoice export\n");

  writeJson(
    join(runPath, "run-status.json"),
    withSchemaUrl(
      "run-status",
      runStatus({
        namespace: "example",
        shortName: "invoice-export",
        runId: "invoice-export-1792667922832",
        state: "running",
        createdAt: "2026-10-22T09:00:00.000Z",
        updatedAt: "2026-10-22T09:00:00.000Z",
        phasesCount: 4,
        currentPhaseIndex: 2,
      }),
    ),
  );
  writeJson(
    join(phaseFolder, "status.json"),
    phaseStatusFile({
      phaseId: "phase-03",
      phaseIndex: 2,
      state: "running",
      model: "claude-sonnet-5-5",
      effort: "medium",
      branchName: "phax/invoice-export--phase-03",
      base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      worktreePath: worktree,
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: "2026-10-22T09:00:00.000Z",
      mode: "interactive",
    }),
  );
  for (const [id, text] of [
    ["phase-01", "## What was delivered\n- The export port."],
    ["phase-02", "## What was delivered\n- InvoiceRow, header `invoice_no`."],
  ] as const) {
    mkdirSync(join(runPath, id), { recursive: true });
    writeFileSync(join(runPath, id, "phase-handoff.md"), text);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDir(root);
});

function policy(): SecurityPolicy {
  return {
    mode: "secure",
    filesystem: { allowRead: [worktree], allowWrite: [worktree, join(root, "home", ".phax")] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: ["pnpm test"],
    failClosed: true,
  };
}

async function stopInput(overrides: Partial<DeclaredStopInput> = {}): Promise<DeclaredStopInput> {
  const executedHandoffs = await Effect.runPromise(
    readExecutedHandoffs(runPath, phases, 2).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  return {
    runId: "invoice-export-1792667922832" as RunId,
    shortName: "invoice-export",
    runPath,
    mainCheckout: join(root, "repo"),
    phases,
    phase: phases[2]!,
    phaseIndex: 2,
    phaseFolder,
    worktree,
    provider: "claude-code",
    model: "claude-sonnet-5-5",
    effort: "medium",
    providerEntry: undefined,
    policy: policy(),
    agentCommands: ["pnpm test"],
    gateCommands: ["pnpm typecheck", "pnpm test"],
    planSections,
    executedHandoffs,
    ...overrides,
  };
}

function layers(backend: ReturnType<typeof makeFakeBackend>) {
  return Layer.mergeAll(
    backend.layer,
    NodeFileSystemLayer,
    NodeGitLayer,
    makeFakeShell().layer,
    NoopSystemTelemetryLayer,
  );
}

async function stop(
  backend: ReturnType<typeof makeFakeBackend>,
  overrides: Partial<DeclaredStopInput> = {},
): Promise<DeclaredStopReport> {
  const input = await stopInput(overrides);
  return Effect.runPromise(stopAtDeclaredPhase(input).pipe(Effect.provide(layers(backend))));
}

function answering(finalText = JSON.stringify(reading)) {
  const backend = makeFakeBackend();
  backend.impl.addRunResponse({ sessionId: SESSION, outputPath: "", finalText });
  return backend;
}

describe("stopAtDeclaredPhase — a valid first turn", () => {
  it("makes the session current and writes first-reading.md", async () => {
    const backend = answering();
    const report = await stop(backend);

    const session = readSession();
    expect(session.current).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      sessionId: SESSION,
      origin: "first-turn",
    });
    expect(session.history).toEqual([]);
    expect(session.turnInProgress).toBeNull();
    expect(session.firstTurns).toEqual([
      expect.objectContaining({ outcome: "answered", origin: "first-turn", sessionId: SESSION }),
    ]);
    const firstReading = readFileSync(join(phaseFolder, "first-reading.md"), "utf8");
    expect(firstReading).toContain("The InvoiceRow column order");
    expect(firstReading).toContain("phase-04: the column order and the header wording");
    expect(report.firstReading).toBe(firstReading);
    expect(report.firstTurnProblem).toBeNull();
    expect(report.unverifiedProvider).toBe(false);
  });

  it("runs the turn read-only with no shell and no phase folder, to first-turn-01.jsonl", async () => {
    const backend = answering();
    await stop(backend);
    expect(backend.impl.runCalls).toHaveLength(1);
    const { prompt, options } = backend.impl.runCalls[0]!;
    expect(options).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      cwd: worktree,
      readOnly: true,
      agentCommands: [],
      outputJsonlPath: join(phaseFolder, "first-turn-01.jsonl"),
    });
    expect(options.phaseFolderPath).toBeUndefined();
    expect(prompt).toContain("Read .phax-context/interactive-review.md");
    expect(prompt).toContain("first-reading JSON Schema");
    expect(prompt).toMatch(
      /`\$schema` first, set to `https:\/\/docs\.phax\.run\/schemas\/first-reading\/\d+\.\d+\.\d+\.json`/,
    );
    expect(backend.impl.resumeCalls).toHaveLength(0);
  });

  it("writes two identical seeds holding every part of a declared seed", async () => {
    await stop(answering());
    const inWorktree = readFileSync(
      join(worktree, ".phax-context", "interactive-review.md"),
      "utf8",
    );
    const inRunFolder = readFileSync(join(phaseFolder, "review-seed.md"), "utf8");
    expect(inWorktree).toBe(inRunFolder);
    for (const part of [
      "# Interactive review: phase-03 of invoice-export",
      "## What is expected of you",
      "Turn each correction into a guard",
      "Keep the scope",
      ".phax-context/correction-handoff.md",
      "## What to review (plan, phase-03 — Review the export record)",
      DETAILED,
      "### phase-01 — Export port — handoff",
      "- The export port.",
      "### phase-02 — Invoice CSV record — handoff",
      "### phase-04 — Credit notes export",
      "Copy the invoice row for credit notes.",
      "Full plan: .phax-context/plan.md",
      "## Gate\npnpm typecheck\npnpm test\n",
      "phax resume invoice-export",
    ]) {
      expect(inWorktree).toContain(part);
    }
    expect(inWorktree.indexOf("phase-01 — Export port")).toBeLessThan(
      inWorktree.indexOf("phase-02 — Invoice CSV record"),
    );
    expect(inWorktree).not.toContain("The standard gate.");
  });

  it("writes review-stop.json with its $schema, the stop's facts and its commands", async () => {
    const report = await stop(answering());
    const path = join(runPath, "review-stop.json");
    expect(report.reviewStopPath).toBe(path);
    const raw = readJson(path);
    expect(Object.keys(raw)[0]).toBe("$schema");
    const url = parseSchemaUrl(raw["$schema"]);
    expect(url?.formatId).toBe("review-stop");
    expect(url?.release).toMatch(RELEASE);

    const { reviewStop } = report;
    expect(reviewStop).toMatchObject({
      run: "invoice-export",
      state: "awaiting_review",
      cause: "declared",
      phase: { id: "phase-03", mode: "interactive", position: 3, of: 4 },
      worktree,
      seed: join(worktree, ".phax-context", "interactive-review.md"),
      firstReading: join(phaseFolder, "first-reading.md"),
      session: {
        provider: "claude-code",
        sessionId: SESSION,
        origin: "first-turn",
        interactiveResume: "verified",
      },
      lastClose: null,
      closeBase: null,
    });
    expect(reviewStop.commands.continue).toMatchObject({ cwd: worktree, env: {} });
    expect(reviewStop.commands.continue?.argv.slice(0, 3)).toEqual(["claude", "--resume", SESSION]);
    expect(reviewStop.commands.continue?.argv).toContain("acceptEdits");
    expect(reviewStop.commands.freshStart.argv.at(-1)).toBe(
      "Read .phax-context/interactive-review.md, then review phase-03 with me.",
    );
    const mainCheckout = join(root, "repo");
    expect(reviewStop.commands.enterPhase).toEqual({
      cwd: mainCheckout,
      argv: ["phax", "enter-phase", "invoice-export", "phase-03"],
      env: {},
    });
    expect(reviewStop.commands.close.argv).toEqual(["phax", "resume", "invoice-export"]);
    expect(reviewStop.commands.reset.argv).toEqual([
      "phax",
      "reset-phase",
      "invoice-export",
      "phase-03",
    ]);

    const read = await Effect.runPromise(
      readReviewStop(runPath, phaseFolder).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    expect(read).toEqual({ reviewStop, path });
  });

  it("moves the run and the phase to awaiting_review and writes resume-instructions.md", async () => {
    await stop(answering());
    expect(readJson(join(runPath, "run-status.json"))).toMatchObject({
      state: "awaiting_review",
      stoppedReason: "awaiting_review",
    });
    const status = readJson(join(phaseFolder, "status.json"));
    expect(status).toMatchObject({
      state: "awaiting_review",
      mode: "interactive",
      stop: { cause: "declared", status: "waiting" },
    });
    expect(status).not.toHaveProperty("claudeSessionId");
    const instructions = readFileSync(join(runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain(worktree);
    expect(instructions).toContain("phax resume invoice-export");
  });

  it("reads no stdin", async () => {
    const read = vi.spyOn(process.stdin, "read");
    const listeners = process.stdin.listenerCount("data") + process.stdin.listenerCount("readable");
    await stop(answering());
    expect(read).not.toHaveBeenCalled();
    expect(process.stdin.listenerCount("data") + process.stdin.listenerCount("readable")).toBe(
      listeners,
    );
  });
});

describe("stopAtDeclaredPhase — a first turn that edits", () => {
  it("restores a file the turn edited, keeps its version and offers a fresh start only", async () => {
    const backend = answering();
    backend.impl.setOnRunAgent((_prompt, options) => {
      writeFileSync(join(options.cwd, "src", "invoiceRow.ts"), "export const header = 'oops';\n");
      writeFileSync(join(options.cwd, "src", "added.ts"), "export {};\n");
    });
    const report = await stop(backend);

    expect(readFileSync(join(worktree, "src", "invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'invoice_no';\n",
    );
    expect(existsSync(join(worktree, "src", "added.ts"))).toBe(false);
    const keptAt = join(phaseFolder, "refused-turn-01");
    expect(readFileSync(join(keptAt, "src", "invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'oops';\n",
    );
    expect(readFileSync(join(keptAt, "src", "added.ts"), "utf8")).toBe("export {};\n");

    const session = readSession();
    expect(session.current).toBeNull();
    expect(session.firstTurns).toEqual([
      expect.objectContaining({
        outcome: "refused-change",
        changedPaths: ["src/added.ts", "src/invoiceRow.ts"],
        keptAt,
      }),
    ]);
    expect(existsSync(join(phaseFolder, "first-reading.md"))).toBe(false);
    expect(report.firstTurnProblem).toMatchObject({ outcome: "refused-change", keptAt });
    expect(report.firstReading).toBeNull();
    expect(report.reviewStop.session).toBeNull();
    expect(report.reviewStop.firstReading).toBeNull();
    expect(report.reviewStop.commands.continue).toBeNull();
    expect(report.reviewStop.commands.freshStart.argv[0]).toBe("claude");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("keeps a binary file the turn wrote byte for byte", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80, 0x0a, 0xc3]);
    const backend = answering();
    backend.impl.setOnRunAgent((_prompt, options) => {
      writeFileSync(join(options.cwd, "src", "logo.png"), bytes);
    });
    await stop(backend);
    expect(existsSync(join(worktree, "src", "logo.png"))).toBe(false);
    expect(readFileSync(join(phaseFolder, "refused-turn-01", "src", "logo.png"))).toEqual(bytes);
  });

  it("refuses a turn that writes the person's handoff file, and removes it", async () => {
    const backend = answering();
    backend.impl.setOnRunAgent((_prompt, options) => {
      writeFileSync(
        join(options.cwd, ".phax-context", "correction-handoff.md"),
        "## Written by the turn\n",
      );
    });
    const report = await stop(backend);
    expect(existsSync(join(worktree, ".phax-context", "correction-handoff.md"))).toBe(false);
    expect(report.firstTurnProblem).toMatchObject({
      outcome: "refused-change",
      changedPaths: [".phax-context/correction-handoff.md"],
    });
    expect(
      readFileSync(
        join(phaseFolder, "refused-turn-01", ".phax-context", "correction-handoff.md"),
        "utf8",
      ),
    ).toBe("## Written by the turn\n");
    expect(readSession().current).toBeNull();
  });

  it("puts the person's own handoff file back when a turn rewrote it", async () => {
    writeFileSync(join(worktree, ".phax-context", "correction-handoff.md"), "## Ada's\n");
    const backend = answering();
    backend.impl.setOnRunAgent((_prompt, options) => {
      writeFileSync(join(options.cwd, ".phax-context", "correction-handoff.md"), "## The turn's\n");
    });
    await stop(backend);
    expect(readFileSync(join(worktree, ".phax-context", "correction-handoff.md"), "utf8")).toBe(
      "## Ada's\n",
    );
    expect(readdirSync(phaseFolder).filter((f) => f.endsWith("-correction-handoff.md"))).toEqual(
      [],
    );
  });

  it("rewrites the worktree's seed after the turn", async () => {
    const backend = answering();
    backend.impl.setOnRunAgent((_prompt, options) => {
      writeFileSync(join(options.cwd, ".phax-context", "interactive-review.md"), "tampered\n");
    });
    await stop(backend);
    expect(readFileSync(join(worktree, ".phax-context", "interactive-review.md"), "utf8")).toBe(
      readFileSync(join(phaseFolder, "review-seed.md"), "utf8"),
    );
    expect(readSession().current?.sessionId).toBe(SESSION);
  });

  it("settles a turn interrupted after it edited a file before running the next one", async () => {
    const beforeTree = git("rev-parse", "HEAD^{tree}").trim();
    const interrupted: InteractiveSession = {
      phaseId: "phase-03",
      provider: "claude-code",
      interactiveResume: "verified",
      current: null,
      history: [],
      firstTurns: [],
      turnInProgress: {
        kind: "first-turn",
        turn: 1,
        origin: "first-turn",
        beforeTree,
        personHandoffBefore: null,
        startedAt: "2026-10-22T09:05:00.000Z",
      },
      transcripts: null,
      builderUsage: null,
    };
    writeJson(
      join(phaseFolder, "interactive-session.json"),
      withSchemaUrl("interactive-session", interrupted),
    );
    writeFileSync(join(phaseFolder, "first-turn-01.jsonl"), "");
    writeFileSync(join(worktree, "src", "invoiceRow.ts"), "export const header = 'half-done';\n");

    const backend = answering();
    await stop(backend);

    expect(readFileSync(join(worktree, "src", "invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'invoice_no';\n",
    );
    expect(readFileSync(join(phaseFolder, "refused-turn-01", "src", "invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'half-done';\n",
    );
    const session = readSession();
    expect(session.firstTurns).toEqual([
      expect.objectContaining({
        outcome: "refused-change",
        startedAt: "2026-10-22T09:05:00.000Z",
        changedPaths: ["src/invoiceRow.ts"],
        keptAt: join(phaseFolder, "refused-turn-01"),
      }),
      expect.objectContaining({ outcome: "answered", sessionId: SESSION }),
    ]);
    expect(session.current?.sessionId).toBe(SESSION);
    expect(backend.impl.runCalls[0]?.options.outputJsonlPath).toBe(
      join(phaseFolder, "first-turn-02.jsonl"),
    );
  });

  it("settles an interrupted turn that changed nothing as failed, interrupted", async () => {
    const beforeTree = git("rev-parse", "HEAD^{tree}").trim();
    writeJson(
      join(phaseFolder, "interactive-session.json"),
      withSchemaUrl("interactive-session", {
        phaseId: "phase-03",
        provider: "claude-code",
        interactiveResume: "verified",
        current: null,
        history: [],
        firstTurns: [],
        turnInProgress: {
          kind: "first-turn",
          turn: 1,
          origin: "first-turn",
          beforeTree,
          personHandoffBefore: null,
          startedAt: "2026-10-22T09:05:00.000Z",
        },
        transcripts: null,
        builderUsage: null,
      } satisfies InteractiveSession),
    );
    await stop(answering());
    expect(readSession().firstTurns[0]).toMatchObject({
      outcome: "failed",
      reason: "interrupted",
      resetAt: null,
    });
  });
});

describe("stopAtDeclaredPhase — a first turn that fails", () => {
  it("records a rate limit as failed with its reset, keeps no session, and still stops", async () => {
    const backend = makeFakeBackend();
    backend.impl.failRunWithRateLimit(0, { kind: "rate_limit", resetAt: "2026-10-22T14:20:00Z" });
    const report = await stop(backend);
    expect(report.firstTurnProblem).toMatchObject({
      outcome: "failed",
      reason: "rate-limit",
      resetAt: "2026-10-22T14:20:00Z",
    });
    expect(readSession().current).toBeNull();
    expect(report.reviewStop.commands.continue).toBeNull();
    expect(readJson(join(runPath, "run-status.json"))).toMatchObject({ state: "awaiting_review" });
  });

  it("records a provider error as failed", async () => {
    const report = await stop(makeFakeBackend());
    expect(report.firstTurnProblem).toMatchObject({ outcome: "failed", reason: "provider-error" });
    expect(readSession().current).toBeNull();
  });

  it("records two answers without $schema as failed after exactly one corrective resume", async () => {
    const { $schema: _schema, ...unversioned } = reading;
    const backend = answering(JSON.stringify(unversioned));
    backend.impl.addResumeResponse({
      sessionId: SESSION,
      outputPath: "",
      finalText: JSON.stringify(unversioned),
    });
    const report = await stop(backend);
    expect(backend.impl.resumeCalls).toHaveLength(1);
    expect(backend.impl.resumeCalls[0]).toMatchObject({
      sessionId: SESSION,
      options: { readOnly: true, outputJsonlPath: join(phaseFolder, "first-turn-01-retry.jsonl") },
    });
    expect(backend.impl.resumeCalls[0]?.prompt).toMatch(
      /`\$schema` first, set to `https:\/\/docs\.phax\.run\/schemas\/first-reading\/\d+\.\d+\.\d+\.json`/,
    );
    expect(report.firstTurnProblem).toMatchObject({ outcome: "failed", reason: "invalid-answer" });
    expect(readSession().current).toBeNull();
  });

  it("keeps the corrective answer when it is valid", async () => {
    const backend = answering("not JSON at all");
    backend.impl.addResumeResponse({
      sessionId: SESSION,
      outputPath: "",
      finalText: JSON.stringify(reading),
    });
    const report = await stop(backend);
    expect(report.firstTurnProblem).toBeNull();
    expect(readSession().current?.sessionId).toBe(SESSION);
  });
});

describe("stopAtDeclaredPhase — providers", () => {
  it("flags mistral-vibe as unverified and builds no continue command", async () => {
    const backend = answering();
    const report = await stop(backend, {
      provider: "mistral-vibe",
      model: "mistral-medium-3.5",
      providerEntry: { enabled: true, executable: "vibe", modelEnvVar: "VIBE_ACTIVE_MODEL" },
    });
    expect(report.unverifiedProvider).toBe(true);
    expect(report.reviewStop.session?.interactiveResume).toBe("unverified");
    expect(report.reviewStop.commands.continue).toBeNull();
    expect(report.reviewStop.commands.freshStart).toMatchObject({
      argv: expect.arrayContaining(["vibe", "--workdir", worktree]) as unknown,
      env: { VIBE_ACTIVE_MODEL: "mistral-medium-3.5" },
    });
    // q-vibe-turns, phase-posture: vibe's turn runs under the phase's policy.
    expect(backend.impl.runCalls[0]?.options.security).toEqual(policy());
  });

  it("names codex's model id in the continue command", async () => {
    const report = await stop(answering(), {
      provider: "codex-cli",
      model: "gpt-6",
      providerEntry: {
        enabled: true,
        executable: "codex",
        families: {
          "openai-gpt": { models: [{ id: "gpt-6-luna", efforts: ["medium"], status: "active" }] },
        },
      },
    });
    expect(report.reviewStop.commands.continue?.argv.slice(0, 4)).toEqual([
      "codex",
      "resume",
      SESSION,
      "-m",
    ]);
    expect(report.reviewStop.commands.continue?.argv[4]).toBe("gpt-6-luna");
  });
});

describe("refreshReviewStop", () => {
  it("rewrites review-stop.json while it exists, and writes nothing once it is gone", async () => {
    const report = await stop(answering());
    const refreshed = { ...report.reviewStop, firstReading: null };
    const provideFs = Effect.provide(NodeFileSystemLayer);
    expect(await Effect.runPromise(refreshReviewStop(runPath, refreshed).pipe(provideFs))).toBe(
      true,
    );
    expect(readJson(join(runPath, "review-stop.json"))).toMatchObject({ firstReading: null });

    rmSync(join(runPath, "review-stop.json"));
    expect(await Effect.runPromise(refreshReviewStop(runPath, refreshed).pipe(provideFs))).toBe(
      false,
    );
    expect(existsSync(join(runPath, "review-stop.json"))).toBe(false);
  });
});

describe("detailedInstructionsOf", () => {
  it("takes the Detailed instructions up to the next heading", () => {
    expect(detailedInstructionsOf(planSections.get("phase-03")!)).toBe(DETAILED);
  });

  it("falls back to the whole section", () => {
    expect(detailedInstructionsOf("## phase-09 — X\n\nBody.")).toBe("## phase-09 — X\n\nBody.");
  });
});
