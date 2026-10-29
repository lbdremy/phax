import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { dispatch, type DispatcherContext } from "../../src/app/dispatcher.js";
import type { PhaxEvent } from "../../src/domain/events.js";
import type { ClaudeSessionId, PhaseId, RunId, WorktreePath } from "../../src/domain/branded.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { readReviewStopFile, withSchemaUrl } from "../../src/schemas/persisted.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { encodeReviewStopFile, type LastClose } from "../../src/schemas/reviewStop.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { reviewStop } from "../helpers/phaseStatusFixture.js";

const runPath = "/state/runs/my-run";
const phaseFolderPath = "/state/runs/my-run/phase-01";

const baseEventFields = {
  eventId: "evt-1",
  occurredAt: "2026-05-21T00:00:00.000Z",
  run: "my-run" as RunId,
  phase: "phase-01" as PhaseId,
};

const runStatusBase = {
  namespace: "test-project",
  shortName: "my-run",
  runId: "my-run-2026-05-21",
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z",
  phasesCount: 1,
  currentPhaseIndex: 0,
} as const;

const phaseStatusBase = {
  phaseId: "phase-01",
  phaseIndex: 0,
  model: "claude-sonnet-4-6",
  effort: "low",
  branchName: "ai/my-run--phase-01",
  base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z",
  mode: "headless",
  stop: null,
} as const;

function seedFs(opts: {
  runState: string;
  phaseState?: string;
  lastError?: string;
  commitHash?: string;
}) {
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile(
    `${runPath}/run-status.json`,
    JSON.stringify(
      withSchemaUrl("run-status", {
        ...runStatusBase,
        hold: { selection: "none" },
        state: opts.runState,
        ...(opts.lastError !== undefined ? { lastError: opts.lastError } : {}),
      }),
    ),
  );
  if (opts.phaseState !== undefined) {
    fakeFs.impl.setFile(
      `${phaseFolderPath}/status.json`,
      JSON.stringify(
        withSchemaUrl("phase-status", {
          ...phaseStatusBase,
          state: opts.phaseState,
          ...(opts.commitHash !== undefined ? { commitHash: opts.commitHash } : {}),
        }),
      ),
    );
  }
  return fakeFs;
}

function makeLayers(fakeFs: ReturnType<typeof seedFs>) {
  const fakeTelemetry = makeFakeSystemTelemetry();
  const fakeGit = makeFakeGit();
  const fakeShell = makeFakeShell();
  const layer = Layer.mergeAll(fakeFs.layer, fakeTelemetry.layer, fakeGit.layer, fakeShell.layer);
  return { layer, fakeTelemetry, fakeGit, fakeShell };
}

const ctx: DispatcherContext = {
  runPath,
  shortName: "my-run",
  phaseFolderPath,
  phaseId: "phase-01",
};

describe("dispatch — handled transitions", () => {
  it("transitions created → running on RunStarted and persists the new run state", async () => {
    const fakeFs = seedFs({ runState: "created" });
    const { layer, fakeTelemetry } = makeLayers(fakeFs);

    const event: PhaxEvent = { type: "RunStarted", ...baseEventFields };

    const result = await Effect.runPromise(
      dispatch(event, { ...ctx, phaseFolderPath: undefined, phaseId: undefined }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result.disposition).toBe("Handled");
    expect(result.stateAfter?.run).toBe("running");

    const telEvents = fakeTelemetry.impl.events();
    expect(telEvents.some((e) => e.type === "state.transition" && e.event === "RunStarted")).toBe(
      true,
    );

    const persisted = JSON.parse(fakeFs.impl.getFile(`${runPath}/run-status.json`)!) as {
      state: string;
    };
    expect(persisted.state).toBe("running");
    expect(Object.keys(persisted)[0]).toBe("$schema");
    expect(persisted).toHaveProperty(
      "$schema",
      schemaUrl("run-status", CURRENT_STAMPS["run-status"]),
    );
    expect(persisted).not.toHaveProperty("version");
  });

  it("transitions phase pending → setting_up_worktree on PhaseStartRequested", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "pending" });
    const { layer, fakeTelemetry } = makeLayers(fakeFs);

    const event: PhaxEvent = {
      type: "PhaseStartRequested",
      ...baseEventFields,
      phaseId: "phase-01" as PhaseId,
    };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Handled");

    const phasePersisted = JSON.parse(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)!) as {
      state: string;
    };
    expect(phasePersisted.state).toBe("setting_up_worktree");

    const telEvents = fakeTelemetry.impl.events();
    expect(
      telEvents.some((e) => e.type === "state.transition" && e.event === "PhaseStartRequested"),
    ).toBe(true);
  });

  it("persists commitHash and state when CommitCreated is handled", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "passed" });
    const { layer } = makeLayers(fakeFs);

    const event: PhaxEvent = {
      type: "CommitCreated",
      ...baseEventFields,
      hash: "deadbeef12345678",
    };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Handled");

    const persisted = JSON.parse(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)!) as {
      state: string;
      commitHash?: string;
    };
    expect(persisted.state).toBe("committed");
    expect(persisted.commitHash).toBe("deadbeef12345678");
    expect(Object.keys(persisted)[0]).toBe("$schema");
    expect(persisted).toHaveProperty(
      "$schema",
      schemaUrl("phase-status", CURRENT_STAMPS["phase-status"]),
    );
    expect(persisted).not.toHaveProperty("version");
  });
});

describe("dispatch — non-handled dispositions", () => {
  it("returns Stale disposition and records step.completed on a stale GateFailed", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "cleaned_up" });
    const { layer, fakeTelemetry } = makeLayers(fakeFs);
    const beforePhase = fakeFs.impl.getFile(`${phaseFolderPath}/status.json`);
    const beforeRun = fakeFs.impl.getFile(`${runPath}/run-status.json`);

    const event: PhaxEvent = {
      type: "GateFailed",
      ...baseEventFields,
      failedStep: "configured",
      command: "pnpm test",
      exitCode: 1,
      protectedChanges: [],
      logPath: "/tmp/log",
      attempt: 1,
    };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Stale");
    expect(result.stateAfter).toBeUndefined();

    expect(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)).toBe(beforePhase);
    expect(fakeFs.impl.getFile(`${runPath}/run-status.json`)).toBe(beforeRun);

    const telEvents = fakeTelemetry.impl.events();
    expect(
      telEvents.some(
        (e) => e.type === "step.completed" && "step" in e && e.step === "dispatch.GateFailed",
      ),
    ).toBe(true);
  });

  it("returns Rejected disposition on archive-from-running", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "running" });
    const { layer, fakeTelemetry } = makeLayers(fakeFs);

    const event: PhaxEvent = {
      type: "RunArchiveRequested",
      ...baseEventFields,
      force: false,
      from: runPath,
      to: `${runPath}-archive`,
    };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Rejected");
    const telEvents = fakeTelemetry.impl.events();
    expect(
      telEvents.some((e) => e.type === "step.completed" && "result" in e && e.result === "failure"),
    ).toBe(true);
  });

  it("returns Ignored disposition when RunResumeRequested arrives on a running run", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "running" });
    const { layer, fakeTelemetry } = makeLayers(fakeFs);

    const event: PhaxEvent = { type: "RunResumeRequested", ...baseEventFields };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Ignored");
    const telEvents = fakeTelemetry.impl.events();
    expect(
      telEvents.some((e) => e.type === "step.completed" && "result" in e && e.result === "success"),
    ).toBe(true);
  });

  it("returns Unexpected disposition when an impossible signal arrives", async () => {
    const fakeFs = seedFs({ runState: "created" });
    const { layer } = makeLayers(fakeFs);

    const event: PhaxEvent = {
      type: "AgentInvocationCompleted",
      ...baseEventFields,
      sessionId: "sess-x" as ClaudeSessionId,
    };

    const result = await Effect.runPromise(
      dispatch(event, { ...ctx, phaseFolderPath: undefined, phaseId: undefined }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result.disposition).toBe("Unexpected");
  });
});

describe("dispatch — invalid persisted state", () => {
  it("fails with FsError when run-status.json is missing", async () => {
    const fakeFs = makeFakeFileSystem();
    const { layer } = makeLayers(fakeFs as unknown as ReturnType<typeof seedFs>);

    const event: PhaxEvent = { type: "RunStarted", ...baseEventFields };

    const result = await Effect.runPromise(
      Effect.either(
        dispatch(event, { ...ctx, phaseFolderPath: undefined, phaseId: undefined }).pipe(
          Effect.provide(layer),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
  });
});

type Fs = ReturnType<typeof seedFs>;

function send(fakeFs: Fs, event: PhaxEvent, at: DispatcherContext = ctx) {
  const { layer } = makeLayers(fakeFs);
  return Effect.runPromise(dispatch(event, at).pipe(Effect.provide(layer)));
}

function readJson(fakeFs: Fs, path: string): object {
  return JSON.parse(fakeFs.impl.getFile(path)!) as object;
}

function readStop(fakeFs: Fs, path: string) {
  const decoded = readReviewStopFile(path, readJson(fakeFs, path));
  if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
  return decoded.right;
}

describe("dispatch — review-stop.json lifecycle", () => {
  const live = `${runPath}/review-stop.json`;
  const parked = `${phaseFolderPath}/review-stop.closing.json`;
  const gateFailed: LastClose = {
    result: "gate-failed",
    at: "2026-05-21T00:05:00.000Z",
    exitCode: 4,
    log: `${phaseFolderPath}/checks-attempt-01.log`,
  };

  async function atStop(): Promise<Fs> {
    const fakeFs = seedFs({ runState: "running", phaseState: "running" });
    // The worktree a refused or interrupted close's instructions name comes from here.
    fakeFs.impl.setFile(
      `${phaseFolderPath}/status.json`,
      JSON.stringify(
        withSchemaUrl("phase-status", {
          ...phaseStatusBase,
          state: "running",
          worktreePath: "/state/worktrees/my-run/phase-01",
        }),
      ),
    );
    await send(fakeFs, {
      type: "ReviewStopReached",
      ...baseEventFields,
      phaseId: "phase-01" as PhaseId,
      cause: "declared",
      worktreePath: "/state/worktrees/my-run/phase-01" as WorktreePath,
      reviewStop: reviewStop(),
    });
    return fakeFs;
  }

  it("writes the stop stamped with its $schema, and the run and phase statuses at awaiting_review", async () => {
    const fakeFs = await atStop();
    const raw = readJson(fakeFs, live);
    expect(Object.keys(raw)[0]).toBe("$schema");
    expect(raw).toHaveProperty("$schema", schemaUrl("review-stop", CURRENT_STAMPS["review-stop"]));
    expect(readStop(fakeFs, live)).toEqual(reviewStop());
    expect(readJson(fakeFs, `${runPath}/run-status.json`)).toMatchObject({
      state: "awaiting_review",
      stoppedReason: "awaiting_review",
    });
    expect(readJson(fakeFs, `${phaseFolderPath}/status.json`)).toMatchObject({
      state: "awaiting_review",
      stop: { cause: "declared", status: "waiting" },
    });
    const instructions = fakeFs.impl.getFile(`${runPath}/resume-instructions.md`);
    expect(instructions).toContain("/state/worktrees/my-run/phase-01");
    expect(instructions).toContain("phax enter-phase my-run phase-01");
    expect(instructions).toContain("phax resume my-run");
    expect(instructions).toContain("phax reset-phase my-run phase-01");
  });

  it("parks the stop on resume and restores it with lastClose on a refused close", async () => {
    const fakeFs = await atStop();
    await send(fakeFs, { type: "RunResumeRequested", ...baseEventFields });
    expect(fakeFs.impl.getFile(live)).toBeUndefined();
    expect(readStop(fakeFs, parked)).toEqual(reviewStop());

    await send(fakeFs, {
      type: "StopCloseRefused",
      ...baseEventFields,
      phaseId: "phase-01" as PhaseId,
      lastClose: gateFailed,
    });
    expect(fakeFs.impl.getFile(parked)).toBeUndefined();
    expect(readStop(fakeFs, live)).toEqual(reviewStop({ lastClose: gateFailed }));
    expect(readJson(fakeFs, `${runPath}/run-status.json`)).toMatchObject({
      state: "awaiting_review",
      lastError: "Close of the stop refused: gate-failed (exit 4)",
    });
    expect(fakeFs.impl.getFile(`${runPath}/resume-instructions.md`)).toContain(
      "/state/worktrees/my-run/phase-01",
    );
  });

  it("keeps every other field, closeBase included, when an interrupted close restores the stop", async () => {
    const fakeFs = await atStop();
    const closeBase = "0123456789abcdef0123456789abcdef01234567";
    fakeFs.impl.setFile(
      live,
      JSON.stringify(encodeReviewStopFile(withSchemaUrl("review-stop", reviewStop({ closeBase })))),
    );
    await send(fakeFs, { type: "RunResumeRequested", ...baseEventFields });
    await send(fakeFs, { type: "RunInterruptRequested", ...baseEventFields });
    expect(readStop(fakeFs, live)).toEqual(
      reviewStop({
        closeBase,
        lastClose: { result: "interrupted", at: baseEventFields.occurredAt, exitCode: 130 },
      }),
    );
    expect(fakeFs.impl.getFile(parked)).toBeUndefined();
  });

  it("discards the stop when the close commits", async () => {
    const fakeFs = await atStop();
    await send(fakeFs, { type: "RunResumeRequested", ...baseEventFields });
    await send(fakeFs, {
      type: "StopCommitted",
      ...baseEventFields,
      phaseId: "phase-01" as PhaseId,
      hash: "deadbeef12345678",
      closure: {
        outcome: "unchanged",
        closedBy: { name: "Ada Example", email: "ada@example.com" },
      },
    });
    expect(fakeFs.impl.getFile(live)).toBeUndefined();
    expect(fakeFs.impl.getFile(parked)).toBeUndefined();
    expect(readJson(fakeFs, `${phaseFolderPath}/status.json`)).toMatchObject({
      state: "committed",
      commitHash: "deadbeef12345678",
      stop: {
        cause: "declared",
        status: "closed",
        outcome: "unchanged",
        closedBy: { name: "Ada Example", email: "ada@example.com" },
      },
    });
  });

  it("discards the stop and any parked copy before a forced archive moves the run folder", async () => {
    const fakeFs = await atStop();
    fakeFs.impl.setFile(parked, "{}");
    await send(
      fakeFs,
      {
        type: "RunArchiveRequested",
        ...baseEventFields,
        force: true,
        from: runPath,
        to: "/state/archive/my-run/run",
      },
      { ...ctx, phaseFolderPath: undefined, phaseId: undefined },
    );
    const remaining = [...fakeFs.impl.files.keys()].filter((path) => path.includes("review-stop"));
    expect(remaining).toEqual([]);
    expect(fakeFs.impl.getFile("/state/archive/my-run/run/run-status.json")).toBeDefined();
  });
});
