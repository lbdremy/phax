/**
 * The gate request through executePlan: built once per phase entry from the
 * phase's noted base, the terminal firing condition and the plan auditor's
 * projection, then saved beside every attempt of a declaring step. Fake git,
 * shell and backend; real filesystem in a temp dir. Every value is made up.
 */
import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId } from "../../src/domain/branded.js";
import { GateAttemptsExhaustedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { readPhaxPlanFile } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
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

const PLAN_MD = "# Gate request plan\n\nMade-up phases.\n";
const shortName = Either.getOrThrow(decodeShortName("my-run"));
const RUN_BRANCH = "ai/my-run";
const PHASE_01_BRANCH = `${RUN_BRANCH}--phase-01`;
const PHASE_01_MOVED_TIP = "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
const PHASE_01_LATER_TIP = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

const AUDIT: GateStep = {
  command: "node ./audit.mjs",
  surface: "structural",
  firing: "every-phase",
  output: "log",
  input: "gate-request",
};

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
    phase("02", {
      create: ["src/io.ts"],
      edit: ["src/greet.ts", "src/io.ts"],
      optional: ["docs/io.md"],
    }),
    phase("03", { create: [], edit: ["src/index.ts"], optional: [] }),
  ],
};

const singlePhaseRawPlan = {
  version: 1,
  run,
  phases: [phase("01", { create: ["src/greet.ts"], edit: [], optional: ["README.md"] })],
};

let stateRoot: string;

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "phax-gate-request-run-"));
});

afterEach(async () => {
  await rm(stateRoot, { recursive: true, force: true });
});

function worktreeOf(phaseId: string): string {
  return join(stateRoot, "worktrees", "test-project.my-run", phaseId);
}

function makeConfig(): ResolvedConfig {
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
  };
}

function makeFakes(auditExitCode: number) {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  const fakeShell = makeFakeShell();
  for (const command of ["true", "git diff HEAD^ HEAD"]) {
    fakeShell.impl.setResponse(command, { exitCode: 0, stdout: "", stderr: "" });
  }
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

function addSessions(fakeBackend: ReturnType<typeof makeFakeBackend>, ids: readonly string[]) {
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

async function startRun(rawPlan: unknown, layers: ReturnType<typeof makeFakes>["layers"]) {
  const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));
  const config = makeConfig();
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, PLAN_MD, plan, config).pipe(Effect.provide(layers)),
  );
  const execute = (withLayers: typeof layers) =>
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
          startIndex: 0,
        }).pipe(Effect.provide(withLayers)),
      ),
    );
  return { runPath, execute };
}

function readRequest(runPath: string, phaseId: string, attempt: string): Promise<string> {
  return readFile(join(runPath, phaseId, `checks-attempt-${attempt}.request.json`), "utf8");
}

async function readStatusBase(runPath: string, phaseId: string): Promise<string> {
  const status = JSON.parse(await readFile(join(runPath, phaseId, "status.json"), "utf8")) as {
    base: string;
  };
  return status.base;
}

describe("executePlan writes each phase's gate request", () => {
  it("hands phase-02 its noted base, a false terminal and the run's projection", async () => {
    await seedHandoffs(["phase-01", "phase-02", "phase-03"]);
    const { fakeGit, fakeBackend, layers } = makeFakes(0);
    for (const phaseId of ["phase-01", "phase-02"]) {
      fakeGit.impl.enqueueWorktreeIsClean(worktreeOf(phaseId), false, true);
    }
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-03"), false);
    addSessions(fakeBackend, ["sess-01", "sess-02", "sess-03"]);
    // A commit on phase-01's branch moves its tip before phase-02's branch is
    // created from it.
    fakeBackend.impl.setOnRunAgent((_prompt, options) => {
      if (basename(options.phaseFolderPath ?? "") === "phase-01") {
        fakeGit.impl.setBranchRef(PHASE_01_BRANCH, PHASE_01_MOVED_TIP);
      }
    });

    const { runPath, execute } = await startRun(threePhaseRawPlan, layers);
    const result = await execute(layers);

    expect(Either.isRight(result)).toBe(true);
    const raw = await readRequest(runPath, "phase-02", "01");
    const request = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(request)).toEqual(["$schema", "phase", "base", "terminal", "phases"]);
    expect(request["$schema"]).toBe(schemaUrl("gate-request", CURRENT_STAMPS["gate-request"]));
    expect(String(request["$schema"])).toMatch(
      /^https:\/\/docs\.phax\.run\/schemas\/gate-request\//,
    );
    expect(request["phase"]).toBe("phase-02");
    expect(request["base"]).toBe(await readStatusBase(runPath, "phase-02"));
    expect(request["base"]).toBe(PHASE_01_MOVED_TIP);
    expect(request["terminal"]).toBe(false);
    expect(request["phases"]).toEqual([
      { id: "phase-01", files: ["src/greet.ts", "src/index.ts"] },
      { id: "phase-02", files: ["src/io.ts", "src/greet.ts"] },
      { id: "phase-03", files: ["src/index.ts"] },
    ]);
    // The terminal phase's request says so.
    const terminal = JSON.parse(await readRequest(runPath, "phase-03", "01")) as {
      terminal: boolean;
    };
    expect(terminal.terminal).toBe(true);
  });

  it("gives a single-phase plan a terminal request with one entry", async () => {
    await seedHandoffs(["phase-01"]);
    const { fakeGit, fakeBackend, layers } = makeFakes(0);
    fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false);
    addSessions(fakeBackend, ["sess-01"]);

    const { runPath, execute } = await startRun(singlePhaseRawPlan, layers);
    const result = await execute(layers);

    expect(Either.isRight(result)).toBe(true);
    const request = JSON.parse(await readRequest(runPath, "phase-01", "01")) as {
      phase: string;
      base: string;
      terminal: boolean;
      phases: unknown[];
    };
    expect(request.phase).toBe("phase-01");
    expect(request.base).toBe(await readStatusBase(runPath, "phase-01"));
    expect(request.base).toMatch(/^[0-9a-f]{40}$/);
    expect(request.terminal).toBe(true);
    expect(request.phases).toEqual([{ id: "phase-01", files: ["src/greet.ts"] }]);
  });

  it("resumes after exhausted gates with a byte-identical request, whatever the branch tip", async () => {
    await seedHandoffs(["phase-01"]);

    // First run: the gate never passes, one fix, then the run pauses.
    const first = makeFakes(1);
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
    const { runPath, execute } = await startRun(singlePhaseRawPlan, first.layers);
    const paused = await execute(first.layers);

    expect(Either.isLeft(paused)).toBe(true);
    if (Either.isLeft(paused)) expect(paused.left).toBeInstanceOf(GateAttemptsExhaustedError);
    const attempt01 = await readRequest(runPath, "phase-01", "01");
    expect(await readRequest(runPath, "phase-01", "02")).toBe(attempt01);

    // The fake backend does not record the session id the real adapter writes;
    // gate-first resume refuses to run without one.
    const statusPath = join(runPath, "phase-01", "status.json");
    await writeFile(
      statusPath,
      JSON.stringify(
        {
          ...(JSON.parse(await readFile(statusPath, "utf8")) as object),
          claudeSessionId: "sess-original",
        },
        null,
        2,
      ),
    );

    // Resume with the gate fixed and phase-01's branch tip moved meanwhile.
    const second = makeFakes(0);
    second.fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false);
    second.fakeGit.impl.setBranchRef(PHASE_01_BRANCH, PHASE_01_LATER_TIP);
    second.fakeBackend.impl.addResumeResponse({
      sessionId: "sess-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    const resumed = await execute(second.layers);

    expect(Either.isRight(resumed)).toBe(true);
    expect(second.fakeBackend.impl.runCalls).toHaveLength(0);
    const attempt03 = await readRequest(runPath, "phase-01", "03");
    expect(attempt03).toBe(attempt01);
    expect((JSON.parse(attempt03) as { base: string }).base).not.toBe(PHASE_01_LATER_TIP);
  });
});
