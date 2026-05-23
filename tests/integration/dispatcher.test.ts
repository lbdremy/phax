import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { dispatch, type DispatcherContext } from "../../src/app/dispatcher.js";
import type { PhaxEvent } from "../../src/domain/events.js";
import type { ClaudeSessionId, PhaseId, RunId } from "../../src/domain/branded.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeTracer } from "../../src/infra/fakes/tracer.js";

const runPath = "/state/runs/my-run";
const phaseFolderPath = "/state/runs/my-run/phase-01";

const baseEventFields = {
  eventId: "evt-1",
  occurredAt: "2026-05-21T00:00:00.000Z",
  run: "my-run" as RunId,
  phase: "phase-01" as PhaseId,
};

const runStatusBase = {
  version: 1,
  shortName: "my-run",
  runId: "my-run-2026-05-21",
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z",
  phasesCount: 1,
  currentPhaseIndex: 0,
} as const;

const phaseStatusBase = {
  version: 1,
  phaseId: "phase-01",
  phaseIndex: 0,
  model: "claude-sonnet-4-6",
  effort: "low",
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z",
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
    JSON.stringify({
      ...runStatusBase,
      state: opts.runState,
      ...(opts.lastError !== undefined ? { lastError: opts.lastError } : {}),
    }),
  );
  if (opts.phaseState !== undefined) {
    fakeFs.impl.setFile(
      `${phaseFolderPath}/status.json`,
      JSON.stringify({
        ...phaseStatusBase,
        state: opts.phaseState,
        ...(opts.commitHash !== undefined ? { commitHash: opts.commitHash } : {}),
      }),
    );
  }
  return fakeFs;
}

function makeLayers(fakeFs: ReturnType<typeof seedFs>) {
  const fakeTracer = makeFakeTracer();
  const fakeGit = makeFakeGit();
  const fakeShell = makeFakeShell();
  const layer = Layer.mergeAll(fakeFs.layer, fakeTracer.layer, fakeGit.layer, fakeShell.layer);
  return { layer, fakeTracer, fakeGit, fakeShell };
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
    const { layer, fakeTracer } = makeLayers(fakeFs);

    const event: PhaxEvent = { type: "RunStarted", ...baseEventFields };

    const result = await Effect.runPromise(
      dispatch(event, { ...ctx, phaseFolderPath: undefined, phaseId: undefined }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result.disposition).toBe("Handled");
    expect(result.stateAfter?.run).toBe("running");

    const names = fakeTracer.impl.eventNames();
    expect(names).toContain("event.handled");

    const persisted = JSON.parse(fakeFs.impl.getFile(`${runPath}/run-status.json`)!) as {
      state: string;
    };
    expect(persisted.state).toBe("running");
  });

  it("transitions phase pending → setting_up_worktree on PhaseStartRequested", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "pending" });
    const { layer, fakeTracer } = makeLayers(fakeFs);

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

    const handled = fakeTracer.impl.events.filter((e) => e.event === "event.handled");
    expect(handled).toHaveLength(1);
    expect(handled[0]?.details).toMatchObject({
      eventType: "PhaseStartRequested",
      phaseStateBefore: "pending",
    });
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
  });
});

describe("dispatch — non-handled dispositions", () => {
  it("emits event.stale and does not persist on a stale GateFailed", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "cleaned_up" });
    const { layer, fakeTracer } = makeLayers(fakeFs);
    const beforePhase = fakeFs.impl.getFile(`${phaseFolderPath}/status.json`);
    const beforeRun = fakeFs.impl.getFile(`${runPath}/run-status.json`);

    const event: PhaxEvent = {
      type: "GateFailed",
      ...baseEventFields,
      command: "pnpm test",
      exitCode: 1,
      logPath: "/tmp/log",
      attempt: 1,
    };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Stale");
    expect(result.stateAfter).toBeUndefined();

    expect(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)).toBe(beforePhase);
    expect(fakeFs.impl.getFile(`${runPath}/run-status.json`)).toBe(beforeRun);

    const names = fakeTracer.impl.eventNames();
    expect(names).toContain("event.stale");
  });

  it("emits event.rejected on archive-from-running", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "running" });
    const { layer, fakeTracer } = makeLayers(fakeFs);

    const event: PhaxEvent = { type: "RunArchiveRequested", ...baseEventFields };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Rejected");
    expect(fakeTracer.impl.eventNames()).toContain("event.rejected");
  });

  it("emits event.ignored when RunResumeRequested arrives on a running run", async () => {
    const fakeFs = seedFs({ runState: "running", phaseState: "running" });
    const { layer, fakeTracer } = makeLayers(fakeFs);

    const event: PhaxEvent = { type: "RunResumeRequested", ...baseEventFields };

    const result = await Effect.runPromise(dispatch(event, ctx).pipe(Effect.provide(layer)));

    expect(result.disposition).toBe("Ignored");
    expect(fakeTracer.impl.eventNames()).toContain("event.ignored");
  });

  it("emits event.unexpected with failed status when an impossible signal arrives", async () => {
    const fakeFs = seedFs({ runState: "created" });
    const { layer, fakeTracer } = makeLayers(fakeFs);

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
    const unexpected = fakeTracer.impl.events.find((e) => e.event === "event.unexpected");
    expect(unexpected?.status).toBe("failed");
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
