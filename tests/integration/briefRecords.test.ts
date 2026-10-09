/**
 * Pulled briefs reach the phase, and the agent is granted `phax brief`.
 * Through executePlan with a brief provider configured: the pulled records in
 * `.phax-context/briefs/` are copied into the phase folder at the phase's
 * terminal outcome (committed or failed), before its record is written and
 * whether records are on or off, and the folder closes to later pulls. Fake
 * git, shell and backend; real filesystem in a temp dir. Every value is made up.
 */
import { Effect, Either, Layer } from "effect";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeBriefRecord, stampBriefRequest } from "../../src/app/briefProvider.js";
import { executePlan } from "../../src/app/executePlan.js";
import { pullBrief } from "../../src/app/pullBrief.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId } from "../../src/domain/branded.js";
import { outsideBriefRequest } from "../../src/domain/brief/request.js";
import { GateAttemptsExhaustedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl, readPhaxPlanFile } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type BriefConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { decodeSecurityPosture } from "../../src/schemas/securityPosture.js";

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

const PLAN_MD = "# Brief records plan\n\nMade-up phase.\n";
const shortName = Either.getOrThrow(decodeShortName("my-run"));
const BRIEF_COMMAND = "node ./brief.mjs";
const BROKEN_COMMAND = "node ./broken.mjs";
const BRIEF: BriefConfig = { command: BRIEF_COMMAND, push: "findings" };
const GATE_COMMAND = "node ./audit.mjs";

// The spec §6 brief report, made up, printed with its keys in another order
// than the format lists them, at every level.
const ANSWER = {
  findings: [
    {
      due: "this-phase",
      guide: { read: "guides/no-node-import.md", summary: "keep I/O in the module's caller" },
      related: [],
      message: "imports node:fs",
      location: { lines: [1, 1], file: "src/greet.ts" },
      rule: "a module under src/ imports no node: module",
      id: "no-node-import src/greet.ts node:fs",
    },
  ],
  rules: [
    {
      guide: null,
      files: ["src/greet.ts", "src/farewell.ts"],
      rule: "a module under src/ exports its function",
    },
  ],
  $schema: currentSchemaUrl("brief-report"),
};

const rawPlan = {
  version: 1,
  run: { shortName: "my-run", title: "My Run", branch: "ai/my-run", requiredCommands: [] },
  phases: [
    {
      id: "phase-01",
      title: "Phase 01",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-work",
      plannedFilesToCreate: ["src/greet.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): step 01", body: "Does step 01." },
    },
  ],
};

let stateRoot: string;
let stderr: string[];

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "phax-brief-records-"));
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  await mkdir(join(worktree(), ".phax-context"), { recursive: true });
  await writeFile(join(worktree(), ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(stateRoot, { recursive: true, force: true });
});

function worktree(): string {
  return join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
}

function briefsDir(): string {
  return join(worktree(), ".phax-context", "briefs");
}

function makeConfig(opts: {
  readonly brief: BriefConfig | undefined;
  readonly records?: boolean;
  readonly secure?: boolean;
}): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root: stateRoot },
      gateProfiles: {
        full: [{ command: GATE_COMMAND, surface: "local", firing: "every-phase", output: "log" }],
      },
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
      enabled: opts.records ?? false,
      transcript: false,
      destination: { kind: "in-repo" as const },
      autoPush: false,
    },
    security: {
      profile: opts.secure === true ? "secure" : "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    ...(opts.brief !== undefined ? { brief: opts.brief } : {}),
  };
}

const session = (id: string) => ({
  sessionId: id as ClaudeSessionId,
  outputPath: "",
  finalText: "",
});

function makeFakes(opts: { readonly gateExitCode?: number } = {}) {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  const fakeShell = makeFakeShell();
  for (const command of ["true", "git diff HEAD^ HEAD"]) {
    fakeShell.impl.setResponse(command, { exitCode: 0, stdout: "", stderr: "" });
  }
  const gateExitCode = opts.gateExitCode ?? 0;
  fakeShell.impl.setResponse(GATE_COMMAND, {
    exitCode: gateExitCode,
    stdout: "",
    stderr: gateExitCode === 0 ? "" : "red",
  });
  fakeShell.impl.setResponse("git rev-parse HEAD", {
    exitCode: 0,
    stdout: "deadbeef12345678\n",
    stderr: "",
  });
  fakeShell.impl.setResponse(BRIEF_COMMAND, {
    exitCode: 0,
    stdout: JSON.stringify(ANSWER),
    stderr: "",
  });
  fakeShell.impl.setFailure(BROKEN_COMMAND, "timed out after 60000ms: node ./broken.mjs");
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

async function startRun(config: ResolvedConfig, layers: Fakes["layers"]) {
  const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, PLAN_MD, plan, config, undefined, true).pipe(Effect.provide(layers)),
  );
  const execute = (withLayers: Fakes["layers"]) =>
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
          securityMode: config.security.profile,
        }).pipe(Effect.provide(withLayers)),
      ),
    );
  return { runPath, phaseFolder: join(runPath, "phase-01"), execute };
}

/** One real `phax brief` call in the phase worktree, through the fake shell. */
function pull(layers: Fakes["layers"], command = BRIEF_COMMAND) {
  return Effect.runPromise(
    pullBrief({ command, root: worktree(), cwd: worktree(), paths: ["src/greet.ts"] }).pipe(
      Effect.provide(layers),
    ),
  );
}

/** A made-up pulled record, written as the agent's `phax brief` would. */
function writePulledRecord(name: string): void {
  mkdirSync(briefsDir(), { recursive: true });
  writeFileSync(
    join(briefsDir(), name),
    serializeBriefRecord("pulled", stampBriefRequest(outsideBriefRequest(["src/greet.ts"])), {
      kind: "answered",
      answer: ANSWER,
      decoded: { rules: [], findings: [] },
    }),
  );
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function briefFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => /^brief-\d{2,}\.json$/.test(name)).toSorted();
}

describe("the brief grant", () => {
  async function runSecure(brief: BriefConfig | undefined) {
    const { fakeGit, fakeBackend, layers } = makeFakes();
    fakeGit.impl.enqueueWorktreeIsClean(worktree(), false);
    fakeBackend.impl.addRunResponse(session("sess-01"));
    fakeBackend.impl.addResumeResponse(session("sess-01-handoff"));
    const { phaseFolder, execute } = await startRun(makeConfig({ brief, secure: true }), layers);
    expect(Either.isRight(await execute(layers))).toBe(true);
    const posture = Either.getOrThrow(
      decodeSecurityPosture(await readJson(join(phaseFolder, "security.json"))),
    );
    return { posture, agentCommands: fakeBackend.impl.runCalls[0]?.options.agentCommands };
  }

  it("grants phax brief with source brief in a secure run with a provider", async () => {
    const { posture, agentCommands } = await runSecure(BRIEF);
    expect(posture.agentCommands).toContainEqual({
      command: "phax brief",
      source: "brief",
      explicit: false,
      requiredByPlan: false,
      enforcement: "prefix",
      degraded: false,
    });
    expect(posture.agentCommands.at(-1)?.command).toBe("phax brief");
    expect(agentCommands).toContain("phax brief");
  });

  it("grants nothing without a provider", async () => {
    const { posture, agentCommands } = await runSecure(undefined);
    expect(posture.agentCommands.map((r) => r.command)).not.toContain("phax brief");
    expect(agentCommands).not.toContain("phax brief");
  });
});

describe("brief reports are recorded as printed", () => {
  it("keeps the pushed and the pulled report with their keys in their printed order", async () => {
    // The gate never passes, so the phase pauses with the pull still in the worktree.
    const { fakeBackend, layers } = makeFakes({ gateExitCode: 1 });
    fakeBackend.impl.addRunResponse(session("sess-01"));
    fakeBackend.impl.addResumeResponse(session("sess-fix-01"));
    let inSession: Promise<unknown> = Promise.resolve();
    fakeBackend.impl.setOnRunAgent(() => {
      inSession = pull(layers);
    });
    const { phaseFolder, execute } = await startRun(makeConfig({ brief: BRIEF }), layers);
    expect(Either.isLeft(await execute(layers))).toBe(true);
    expect((await inSession) as { kind: string }).toMatchObject({ kind: "answered" });

    const printed = JSON.stringify(ANSWER, null, 2).split("\n").join("\n    ");
    for (const path of [join(phaseFolder, "brief-00.json"), join(briefsDir(), "brief-01.json")]) {
      const text = await readFile(path, "utf8");
      const outcome = (JSON.parse(text) as { outcome: { kind: string; answer: unknown } }).outcome;
      expect(outcome).toEqual({ kind: "answered", answer: ANSWER });
      expect(JSON.stringify(outcome.answer)).toBe(JSON.stringify(ANSWER));
      expect(text).toContain(`"answer": ${printed}`);
    }
  });
});

describe("pulled briefs reach the phase folder", () => {
  it("collects pulls across two sessions in call order, before the record is written", async () => {
    // Session 1: the agent pulls once, the gate never passes, the phase pauses.
    const first = makeFakes({ gateExitCode: 1 });
    first.fakeBackend.impl.addRunResponse(session("sess-original"));
    first.fakeBackend.impl.addResumeResponse(session("sess-fix-01"));
    let inSession: Promise<unknown> = Promise.resolve();
    first.fakeBackend.impl.setOnRunAgent(() => {
      inSession = pull(first.layers);
    });
    const config = makeConfig({ brief: BRIEF, records: true });
    const { phaseFolder, execute } = await startRun(config, first.layers);
    const paused = await execute(first.layers);
    await inSession;
    expect(Either.isLeft(paused)).toBe(true);
    if (Either.isLeft(paused)) expect(paused.left).toBeInstanceOf(GateAttemptsExhaustedError);

    // A paused phase collects nothing; its pulls keep accumulating.
    expect(await briefFiles(phaseFolder)).toEqual(["brief-00.json"]);
    expect(existsSync(join(briefsDir(), "closed"))).toBe(false);
    expect((await pull(first.layers, BROKEN_COMMAND)).kind).toBe("failed");
    expect((await pull(first.layers)).kind).toBe("answered");

    // Session 2: the resumed phase commits.
    const statusPath = join(phaseFolder, "status.json");
    await writeFile(
      statusPath,
      JSON.stringify({ ...(await readJson(statusPath)), claudeSessionId: "sess-original" }),
    );
    const second = makeFakes();
    second.fakeGit.impl.enqueueWorktreeIsClean(worktree(), false);
    second.fakeBackend.impl.addResumeResponse(session("sess-handoff"));
    expect(Either.isRight(await execute(second.layers))).toBe(true);

    expect(await briefFiles(phaseFolder)).toEqual([
      "brief-00.json",
      "brief-01.json",
      "brief-02.json",
      "brief-03.json",
    ]);
    const moments = await Promise.all(
      ["brief-00.json", "brief-01.json", "brief-02.json", "brief-03.json"].map(async (name) => {
        const record = await readJson(join(phaseFolder, name));
        return [record["moment"], (record["outcome"] as { kind: string }).kind];
      }),
    );
    expect(moments).toEqual([
      ["pushed", "answered"],
      ["pulled", "answered"],
      ["pulled", "failed"],
      ["pulled", "answered"],
    ]);
    for (const name of ["brief-01.json", "brief-02.json", "brief-03.json"]) {
      expect(await readFile(join(phaseFolder, name), "utf8")).toBe(
        await readFile(join(briefsDir(), name), "utf8"),
      );
    }
    expect(existsSync(join(briefsDir(), "closed"))).toBe(true);

    // The written record lists every brief file.
    const recordWrites = second.fakeGit.impl.calls.flatMap((call) =>
      call.method === "writeTreeCommit" ? [call.paths] : [],
    );
    expect(recordWrites).toHaveLength(1);
    const recorded = (recordWrites[0] ?? []).map((path) => path.split("/").at(-1));
    for (const name of ["brief-00.json", "brief-01.json", "brief-02.json", "brief-03.json"]) {
      expect(recorded).toContain(name);
    }

    // A pull after collection is answered and recorded nowhere.
    const before = await readdir(briefsDir());
    expect((await pull(second.layers)).kind).toBe("answered");
    expect(await readdir(briefsDir())).toEqual(before);
    expect(await briefFiles(phaseFolder)).toHaveLength(4);
  });

  it("collects the pulls of a phase that fails terminally", async () => {
    const { fakeGit, fakeBackend, layers } = makeFakes();
    fakeGit.impl.enqueueWorktreeIsClean(worktree(), false);
    // No queued run response: the agent invocation fails, a terminal failure.
    fakeBackend.impl.setOnRunAgent(() => writePulledRecord("brief-01.json"));
    const { phaseFolder, execute } = await startRun(makeConfig({ brief: BRIEF }), layers);
    const result = await execute(layers);

    expect(Either.isLeft(result)).toBe(true);
    expect(await briefFiles(phaseFolder)).toEqual(["brief-00.json", "brief-01.json"]);
    expect(existsSync(join(briefsDir(), "closed"))).toBe(true);
  });

  it("collects the pulls with records disabled", async () => {
    const { fakeGit, fakeBackend, layers } = makeFakes();
    fakeGit.impl.enqueueWorktreeIsClean(worktree(), false);
    fakeBackend.impl.addRunResponse(session("sess-01"));
    fakeBackend.impl.addResumeResponse(session("sess-01-handoff"));
    fakeBackend.impl.setOnRunAgent(() => {
      writePulledRecord("brief-01.json");
      writePulledRecord("brief-10.json");
      writePulledRecord("brief-02.json");
    });
    const config = makeConfig({ brief: BRIEF, records: false });
    const { phaseFolder, execute } = await startRun(config, layers);
    expect(Either.isRight(await execute(layers))).toBe(true);

    expect(await briefFiles(phaseFolder)).toEqual([
      "brief-00.json",
      "brief-01.json",
      "brief-02.json",
      "brief-10.json",
    ]);
    expect(existsSync(join(briefsDir(), "closed"))).toBe(true);
    expect(stderr.join("")).not.toContain("failed to collect pulled briefs");
  });

  it("writes no marker and copies no brief file without a provider", async () => {
    const { fakeGit, fakeBackend, layers } = makeFakes();
    fakeGit.impl.enqueueWorktreeIsClean(worktree(), false);
    fakeBackend.impl.addRunResponse(session("sess-01"));
    fakeBackend.impl.addResumeResponse(session("sess-01-handoff"));
    fakeBackend.impl.setOnRunAgent(() => writePulledRecord("brief-01.json"));
    const { phaseFolder, execute } = await startRun(makeConfig({ brief: undefined }), layers);
    expect(Either.isRight(await execute(layers))).toBe(true);

    expect(await briefFiles(phaseFolder)).toEqual([]);
    expect(existsSync(join(briefsDir(), "closed"))).toBe(false);
  });
});
