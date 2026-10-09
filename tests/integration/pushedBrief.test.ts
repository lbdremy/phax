/**
 * The pushed brief through executePlan: with a brief provider configured, a
 * fresh phase start writes `.phax-context/brief-request.json`, asks the
 * provider once from the phase worktree, records the call as brief-00.json and
 * weaves the section into the first prompt. A failing provider never blocks
 * the phase; a resume restores the request file without asking again. Fake
 * git, shell and backend; real filesystem in a temp dir. Every value is made up.
 */
import { Effect, Either, Layer } from "effect";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId } from "../../src/domain/branded.js";
import { renderBriefSection } from "../../src/domain/brief/render.js";
import { GateAttemptsExhaustedError, RateLimitError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { BriefGuarantee } from "../../src/schemas/brief.js";
import { currentSchemaUrl, readPhaxPlanFile } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type BriefConfig,
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

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

const PLAN_MD = "# Pushed brief plan\n\nMade-up phases.\n";
const shortName = Either.getOrThrow(decodeShortName("my-run"));
const RUN_BRANCH = "ai/my-run";
const BRIEF_COMMAND = "node ./brief.mjs";
const BRIEF: BriefConfig = { command: BRIEF_COMMAND };

const AUDIT: GateStep = {
  command: "node ./audit.mjs",
  surface: "structural",
  firing: "every-phase",
  output: "log",
  input: "gate-request",
};

const GUARANTEES: BriefGuarantee[] = [
  {
    id: "greet-pure",
    statement: "nothing under src/ imports a node: module",
    places: [
      {
        location: { file: "src/greet.ts", line: 2 },
        state: "forbidden",
        due: "this-phase",
        what: "imports node:fs",
        repair: "remove the import",
      },
    ],
  },
  {
    id: "index-exports",
    statement: "src/index.ts re-exports every module",
    places: [{ location: { file: "src/index.ts" }, state: "met" }],
  },
];

const ANSWER = {
  $schema: currentSchemaUrl("brief-answer"),
  guarantees: GUARANTEES,
  note: "an extra key the provider printed",
};

const ANSWERED_SECTION = renderBriefSection({
  kind: "answered",
  answer: { guarantees: GUARANTEES },
});

function phase(n: string, files: { create: string[]; edit: string[]; optional: string[] }) {
  return {
    id: `phase-${n}`,
    title: `Phase ${n}`,
    model: "claude-sonnet-4-6",
    effort: "low" as const,
    planMarkdownAnchor: `#phase-${n}-work`,
    plannedFilesToCreate: files.create,
    plannedFilesToEdit: files.edit,
    optionalFilesToEdit: files.optional,
    commit: { subject: `ai(phase-${n}): step ${n}`, body: `Does step ${n}.` },
  };
}

const run = { shortName: "my-run", title: "My Run", branch: RUN_BRANCH, requiredCommands: [] };

const threePhaseRawPlan = {
  version: 1,
  run,
  phases: [
    phase("01", { create: ["src/greet.ts"], edit: ["src/index.ts"], optional: ["README.md"] }),
    phase("02", { create: ["src/io.ts"], edit: ["src/greet.ts"], optional: [] }),
    phase("03", { create: [], edit: ["src/index.ts"], optional: [] }),
  ],
};

const twoPhaseRawPlan = { ...threePhaseRawPlan, phases: threePhaseRawPlan.phases.slice(0, 2) };

const singlePhaseRawPlan = { ...threePhaseRawPlan, phases: threePhaseRawPlan.phases.slice(0, 1) };

let stateRoot: string;
let stderr: string[];

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "phax-pushed-brief-"));
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(stateRoot, { recursive: true, force: true });
});

function worktreeOf(phaseId: string): string {
  return join(stateRoot, "worktrees", "test-project.my-run", phaseId);
}

function requestFileOf(phaseId: string): string {
  return join(worktreeOf(phaseId), ".phax-context", "brief-request.json");
}

function makeConfig(brief: BriefConfig | undefined): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root: stateRoot },
      gateProfiles: { full: [AUDIT] },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot,
    namespace: "test-project",
    repoRoot: stateRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" as const },
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
    ...(brief !== undefined ? { brief } : {}),
  };
}

type BriefResponse =
  | { readonly kind: "answer"; readonly stdout: string; readonly exitCode?: number }
  | { readonly kind: "failure"; readonly message: string };

function makeFakes(opts: {
  readonly auditExitCode?: number;
  readonly briefCommand?: string;
  readonly brief?: BriefResponse;
}) {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  const fakeShell = makeFakeShell();
  for (const command of ["true", "git diff HEAD^ HEAD"]) {
    fakeShell.impl.setResponse(command, { exitCode: 0, stdout: "", stderr: "" });
  }
  const auditExitCode = opts.auditExitCode ?? 0;
  fakeShell.impl.setResponse("node ./audit.mjs", {
    exitCode: auditExitCode,
    stdout: "",
    stderr: auditExitCode === 0 ? "" : "red",
  });
  fakeShell.impl.setResponse("git rev-parse HEAD", {
    exitCode: 0,
    stdout: "deadbeef12345678\n",
    stderr: "",
  });
  const brief = opts.brief ?? { kind: "answer", stdout: JSON.stringify(ANSWER) };
  const briefCommand = opts.briefCommand ?? BRIEF_COMMAND;
  if (brief.kind === "failure") {
    fakeShell.impl.setFailure(briefCommand, brief.message);
  } else {
    fakeShell.impl.setResponse(briefCommand, {
      exitCode: brief.exitCode ?? 0,
      stdout: brief.stdout,
      stderr: brief.exitCode ? "provider broke" : "",
    });
  }
  const fakeBackend = makeFakeBackend();
  const layers = Layer.mergeAll(
    fakeGit.layer,
    fakeShell.layer,
    fakeBackend.layer,
    NodeFileSystemLayer,
    NoopSystemTelemetryLayer,
    makeFakeGitHub().layer,
  );
  return { fakeGit, fakeShell, fakeBackend, layers };
}

type Fakes = ReturnType<typeof makeFakes>;

function addSessions(fakeBackend: Fakes["fakeBackend"], ids: readonly string[]) {
  for (const id of ids) {
    fakeBackend.impl.addRunResponse({
      sessionId: id as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: `${id}-handoff` as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
  }
}

async function seedHandoffs(phaseIds: readonly string[]): Promise<void> {
  for (const phaseId of phaseIds) {
    await mkdir(join(worktreeOf(phaseId), ".phax-context"), { recursive: true });
    await writeFile(
      join(worktreeOf(phaseId), ".phax-context", "phase-handoff.md"),
      HANDOFF_CONTENT,
    );
  }
}

async function startRun(rawPlan: unknown, brief: BriefConfig | undefined, layers: Fakes["layers"]) {
  const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));
  const config = makeConfig(brief);
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, PLAN_MD, plan, config).pipe(Effect.provide(layers)),
  );
  const execute = (withLayers: Fakes["layers"], startIndex = 0) =>
    Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: PLAN_MD,
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex,
        }).pipe(Effect.provide(withLayers)),
      ),
    );
  return { runPath, execute };
}

function briefCalls(fakeShell: Fakes["fakeShell"], command = BRIEF_COMMAND) {
  return fakeShell.impl.calls.filter((call) => call.command.join(" ") === command);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function runState(runPath: string): Promise<unknown> {
  return (await readJson(join(runPath, "run-status.json")))["state"];
}

describe("executePlan pushes the phase's brief", () => {
  it("asks once per phase from its worktree with the gate request's facts, and weaves the answer", async () => {
    const phaseIds = ["phase-01", "phase-02", "phase-03"];
    await seedHandoffs(phaseIds);
    const { fakeGit, fakeShell, fakeBackend, layers } = makeFakes({});
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false, true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-02"), false, true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-03"), false);
    addSessions(fakeBackend, ["sess-01", "sess-02", "sess-03"]);

    const { runPath, execute } = await startRun(threePhaseRawPlan, BRIEF, layers);
    const result = await execute(layers);

    expect(Either.isRight(result)).toBe(true);
    const calls = briefCalls(fakeShell);
    expect(calls).toHaveLength(3);
    for (const [n, phaseId] of phaseIds.entries()) {
      const call = calls[n];
      expect(call?.cwd).toBe(worktreeOf(phaseId));
      const sent = JSON.parse(call?.stdin ?? "") as Record<string, unknown>;
      expect(Object.keys(sent)).toEqual([
        "$schema",
        "phase",
        "base",
        "terminal",
        "phases",
        "files",
      ]);
      expect(sent["$schema"]).toBe(currentSchemaUrl("brief-request"));
      expect(sent["files"]).toBeNull();
      const { $schema: _gateSchema, ...gateFacts } = await readJson(
        join(runPath, phaseId, "checks-attempt-01.request.json"),
      );
      const { $schema: _briefSchema, files: _files, ...briefFacts } = sent;
      expect(briefFacts).toEqual(gateFacts);
      expect(sent["phase"]).toBe(phaseId);

      const prompt = await readFile(join(runPath, phaseId, "prompt.md"), "utf8");
      expect(prompt).toContain(`\n\n${ANSWERED_SECTION}\n\n## Execution rules\n`);
      expect(fakeBackend.impl.runCalls[n]?.prompt).toBe(prompt);

      const record = await readJson(join(runPath, phaseId, "brief-00.json"));
      expect(record["moment"]).toBe("pushed");
      expect(record["request"]).toEqual(await readJson(requestFileOf(phaseId)));
      expect(record["request"]).toEqual(sent);
      expect(record["outcome"]).toEqual({ kind: "answered", answer: ANSWER });
    }
    expect(stderr.join("")).not.toContain("brief unavailable");
  });

  it("calls the configured command", async () => {
    await seedHandoffs(["phase-01"]);
    const { fakeGit, fakeShell, fakeBackend, layers } = makeFakes({
      briefCommand: "node ./b.mjs",
    });
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false);
    addSessions(fakeBackend, ["sess-01"]);

    const { execute } = await startRun(singlePhaseRawPlan, { command: "node ./b.mjs" }, layers);
    expect(Either.isRight(await execute(layers))).toBe(true);

    expect(briefCalls(fakeShell, "node ./b.mjs").map((call) => call.command)).toEqual([
      ["node", "./b.mjs"],
    ]);
    expect(briefCalls(fakeShell)).toHaveLength(0);
  });

  it("changes nothing without a brief key", async () => {
    await seedHandoffs(["phase-01"]);
    const { fakeGit, fakeShell, fakeBackend, layers } = makeFakes({});
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false);
    addSessions(fakeBackend, ["sess-01"]);

    const { runPath, execute } = await startRun(singlePhaseRawPlan, undefined, layers);
    expect(Either.isRight(await execute(layers))).toBe(true);

    expect(briefCalls(fakeShell)).toHaveLength(0);
    const prompt = await readFile(join(runPath, "phase-01", "prompt.md"), "utf8");
    expect(prompt).not.toContain("## Brief for this phase");
    expect(existsSync(join(runPath, "phase-01", "brief-00.json"))).toBe(false);
    expect(existsSync(requestFileOf("phase-01"))).toBe(false);
  });
});

describe("a failing pushed brief never blocks the phase", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly brief: BriefResponse;
    readonly reason: string;
  }> = [
    {
      name: "exit 1",
      brief: { kind: "answer", stdout: "", exitCode: 1 },
      reason: "brief provider exited with code 1: provider broke",
    },
    {
      name: "not json",
      brief: { kind: "answer", stdout: "not json" },
      reason: "brief provider returned invalid JSON",
    },
    {
      name: "a timeout",
      brief: { kind: "failure", message: "timed out after 60000ms: node ./brief.mjs" },
      reason: "brief provider timed out after 60000ms: node ./brief.mjs",
    },
    {
      name: "a newer answer release",
      brief: {
        kind: "answer",
        stdout: JSON.stringify({ ...ANSWER, $schema: schemaUrl("brief-answer", "99.0.0") }),
      },
      reason: `brief answer refused at $schema: brief-answer 99.0.0 is newer than this phax (${PHAX_RELEASE}) — upgrade phax to read it; this phax reads ${currentSchemaUrl("brief-answer")}`,
    },
  ];

  async function runOnce(brief: BriefConfig | undefined, response: BriefResponse) {
    const { fakeGit, fakeBackend, layers } = makeFakes({ brief: response });
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false);
    addSessions(fakeBackend, ["sess-01"]);
    const { runPath, execute } = await startRun(singlePhaseRawPlan, brief, layers);
    const result = await execute(layers);
    return { runPath, result, fakeBackend };
  }

  for (const { name, brief, reason } of cases) {
    it(`warns, marks the brief unavailable and runs the phase on ${name}`, async () => {
      await seedHandoffs(["phase-01"]);
      const withBrief = await runOnce(BRIEF, brief);
      const stateWithBrief = await runState(withBrief.runPath);
      const warnings = stderr.join("");

      expect(withBrief.fakeBackend.impl.runCalls).toHaveLength(1);
      expect(warnings).toContain(`[phax] Warning: phase "phase-01" — brief unavailable (${reason}`);
      expect(warnings).toContain("The phase runs without it.");
      const prompt = await readFile(join(withBrief.runPath, "phase-01", "prompt.md"), "utf8");
      expect(prompt).toContain(`The brief is unavailable at phase start (${reason}`);
      expect(prompt).toContain("`phax brief` may still answer.");
      expect(prompt).toContain("To learn where the phase stands, run the gate commands");
      const record = await readJson(join(withBrief.runPath, "phase-01", "brief-00.json"));
      expect(record["moment"]).toBe("pushed");
      const outcome = record["outcome"] as { kind: string; reason: string };
      expect(outcome.kind).toBe("failed");
      expect(outcome.reason.startsWith(reason)).toBe(true);

      // The same run without `brief` ends the same way.
      await rm(join(stateRoot, "runs"), { recursive: true, force: true });
      const without = await runOnce(undefined, brief);
      expect(Either.isRight(withBrief.result)).toBe(Either.isRight(without.result));
      if (Either.isRight(withBrief.result) && Either.isRight(without.result)) {
        expect(withBrief.result.right).toEqual(without.result.right);
      }
      expect(stateWithBrief).toBe(await runState(without.runPath));
    });
  }
});

describe("re-entering a phase asks no new brief", () => {
  it("resumes after exhausted gates by restoring the request file, with no brief call", async () => {
    await seedHandoffs(["phase-01"]);

    const first = makeFakes({ auditExitCode: 1 });
    first.fakeBackend.impl.addRunResponse({
      sessionId: "sess-original" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    first.fakeBackend.impl.addResumeResponse({
      sessionId: "sess-fix-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    const { runPath, execute } = await startRun(singlePhaseRawPlan, BRIEF, first.layers);
    const paused = await execute(first.layers);
    expect(Either.isLeft(paused)).toBe(true);
    if (Either.isLeft(paused)) expect(paused.left).toBeInstanceOf(GateAttemptsExhaustedError);
    expect(briefCalls(first.fakeShell)).toHaveLength(1);

    const recordPath = join(runPath, "phase-01", "brief-00.json");
    const recordBytes = await readFile(recordPath, "utf8");
    await rm(requestFileOf("phase-01"));
    // The fake backend does not record the session id the real adapter writes.
    const statusPath = join(runPath, "phase-01", "status.json");
    await writeFile(
      statusPath,
      JSON.stringify({ ...(await readJson(statusPath)), claudeSessionId: "sess-original" }),
    );

    const second = makeFakes({});
    second.fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false);
    second.fakeBackend.impl.addResumeResponse({
      sessionId: "sess-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    const resumed = await execute(second.layers);

    expect(Either.isRight(resumed)).toBe(true);
    expect(briefCalls(second.fakeShell)).toHaveLength(0);
    expect(second.fakeBackend.impl.runCalls).toHaveLength(0);
    expect(await readFile(recordPath, "utf8")).toBe(recordBytes);
    const record = JSON.parse(recordBytes) as { request: unknown };
    expect(await readJson(requestFileOf("phase-01"))).toEqual(record.request);
    for (const call of second.fakeBackend.impl.resumeCalls) {
      expect(call.prompt).not.toContain("## Brief for this phase");
    }
  });

  it("re-renders the section from brief-00.json on a rate-limited re-entry", async () => {
    await seedHandoffs(["phase-01", "phase-02"]);

    const first = makeFakes({});
    first.fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false, true);
    addSessions(first.fakeBackend, ["sess-01"]);
    first.fakeBackend.impl.failRunWithRateLimit(1, { kind: "rate_limit" });
    const { runPath, execute } = await startRun(twoPhaseRawPlan, BRIEF, first.layers);
    const limited = await execute(first.layers);
    expect(Either.isLeft(limited)).toBe(true);
    if (Either.isLeft(limited)) expect(limited.left).toBeInstanceOf(RateLimitError);
    expect(briefCalls(first.fakeShell)).toHaveLength(2);
    const recordPath = join(runPath, "phase-02", "brief-00.json");
    const recordBytes = await readFile(recordPath, "utf8");

    // A different answer now: the re-entry must not ask for it.
    const second = makeFakes({
      brief: { kind: "answer", stdout: JSON.stringify({ ...ANSWER, guarantees: [] }) },
    });
    second.fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-02"), false);
    addSessions(second.fakeBackend, ["sess-02"]);
    const reentered = await execute(second.layers, 1);

    expect(Either.isRight(reentered)).toBe(true);
    expect(briefCalls(second.fakeShell)).toHaveLength(0);
    expect(await readFile(recordPath, "utf8")).toBe(recordBytes);
    const prompt = second.fakeBackend.impl.runCalls[0]?.prompt ?? "";
    expect(prompt).toContain(`\n\n${ANSWERED_SECTION}\n\n## Execution rules\n`);
    expect(await readFile(join(runPath, "phase-02", "prompt.md"), "utf8")).toBe(prompt);
  });
});
