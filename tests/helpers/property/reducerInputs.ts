// The inputs of the run reducer's properties: one generator per event type and the run's reachable
// states. Hand-built, because `PhaxEvent` and `PhaxState` are TypeScript types with no Effect
// schema, so derive-effect (q-generators) applies only where a schema exists: the review stop and
// its `lastClose` come from `ReviewStopFileSchema` through `fromSchema`. Branded ids are generated
// as strings that satisfy their decoders (checked by the sanity test); error causes are built with
// their classes, and `RunReviewInfo` by hand.
import fc from "fast-check";
import type {
  BranchName,
  ClaudeSessionId,
  PhaseId,
  RunId,
  WorktreePath,
} from "../../../src/domain/branded.js";
import {
  AgentInvocationError,
  AgentSessionFailedError,
  RateLimitError,
  UsageLimitError,
} from "../../../src/domain/errors.js";
import type { PhaxEvent, PhaxEventType } from "../../../src/domain/events.js";
import { interpret } from "../../../src/domain/reducer.js";
import type { RunReviewInfo } from "../../../src/domain/runReviewInfo.js";
import type { ProtectedChange } from "../../../src/domain/security/protectedPaths.js";
import { TERMINAL_PHASE_STATES } from "../../../src/domain/state.js";
import type {
  PhaseSubState,
  PhaseSubStateName,
  PhaxState,
  PhaxStateName,
  StopCause,
} from "../../../src/domain/state.js";
import type { LastClose, ReviewStop } from "../../../src/schemas/reviewStop.js";
import { ReviewStopFileSchema } from "../../../src/schemas/reviewStop.js";
import { fromSchema } from "./fromEffect.js";

// --- Base pieces -------------------------------------------------------------------------------

const word = fc.stringMatching(/^[a-z0-9]{1,12}$/);
const text = fc.string({ maxLength: 20 });
const optional = <T>(a: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> =>
  fc.option(a, { nil: undefined });

const runId = word.map((s) => s as RunId);
const phaseId = fc.nat({ max: 99 }).map((n) => `phase-${String(n).padStart(2, "0")}` as PhaseId);
const worktreePath = word.map((s) => `/tmp/${s}` as WorktreePath);
const sessionId = word.map((s) => s as ClaudeSessionId);
const timestamp = fc
  .date({
    min: new Date("2020-01-01T00:00:00Z"),
    max: new Date("2035-01-01T00:00:00Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());
const attempt = fc.nat({ max: 5 });
const hash = fc.stringMatching(/^[0-9a-f]{7,40}$/);

const baseFields = fc.record({
  eventId: word,
  occurredAt: timestamp,
  run: runId,
  phase: optional(phaseId),
  correlationId: optional(word),
});

const protectedChange: fc.Arbitrary<ProtectedChange> = fc.record({
  path: word,
  kind: fc.constantFrom("created", "edited", "deleted", "renamed", "symlink", "nested-repository"),
  entry: word,
  glob: word,
});
const protectedChanges = fc.array(protectedChange, { maxLength: 3 });
const nonEmptyProtectedChanges = fc
  .tuple(protectedChange, protectedChanges)
  .map(([first, rest]) => [first, ...rest] as const);

const failureKinds = [
  "network",
  "rate-limit",
  "usage-limit",
  "not-authenticated",
  "provider-error",
  "max-turns",
  "killed",
  "unknown",
] as const;

const agentSessionFailedError: fc.Arbitrary<AgentSessionFailedError> = fc
  .record({
    message: text,
    kind: fc.constantFrom(...failureKinds),
    sessionId: fc.option(word, { nil: null }),
    resetAt: fc.option(timestamp, { nil: null }),
    agentErrorLog: fc.option(word, { nil: null }),
    transcript: fc.option(word, { nil: null }),
  })
  .map(
    (r) =>
      new AgentSessionFailedError({
        message: r.message,
        failure: {
          provider: "claude-code",
          kind: r.kind,
          message: r.message,
          sessionId: r.sessionId,
          resetAt: r.resetAt,
        },
        agentErrorLog: r.agentErrorLog,
        transcript: r.transcript,
      }),
  );

const limitError = fc
  .record({ message: text, rawMessage: text, resetAt: optional(timestamp), usage: fc.boolean() })
  .map((r) =>
    r.usage
      ? new UsageLimitError({ message: r.message, rawMessage: r.rawMessage, resetAt: r.resetAt })
      : new RateLimitError({ message: r.message, rawMessage: r.rawMessage, resetAt: r.resetAt }),
  );

const agentInvocationError = fc
  .record({ message: text, stderr: optional(text), excerpt: optional(text) })
  .map(
    (r) =>
      new AgentInvocationError({
        message: r.message,
        stderr: r.stderr,
        ...(r.excerpt === undefined ? {} : { stderrExcerpt: r.excerpt }),
      }),
  );

const runFailedCause: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything({ withNullPrototype: true }),
  text.map((m) => new Error(m)),
  agentInvocationError,
);

const reviewInfo: fc.Arbitrary<RunReviewInfo> = fc
  .record({ a: word, b: word, c: word, d: word, e: optional(word), f: optional(word) })
  .map((r) => ({
    namespace: r.a,
    shortName: r.b,
    runId: r.c,
    runState: "running",
    branch: `ai/${r.b}`,
    runTitle: r.e,
    finalPhaseBranch: `ai/${r.b}--phase-01` as BranchName,
    stateRoot: `/tmp/${r.a}`,
    runPath: `/tmp/${r.a}/runs/${r.c}`,
    finalPhaseId: "phase-01",
    finalPhaseTitle: r.d,
    worktreePath: `/tmp/${r.d}`,
    claudeSessionId: r.f,
    gateProfileId: undefined,
    phaseStatuses: [],
    planPhases: [],
    updatedAt: "2026-05-20T12:00:00Z",
    stoppedReason: undefined,
    lastError: undefined,
  }));

// The review stop and its last close, derived from the file schema; `$schema` is not part of the
// in-memory type the events carry.
const reviewStopFile = fromSchema("ReviewStopFileSchema", ReviewStopFileSchema, { maxSize: 4 });
const reviewStopArb: fc.Arbitrary<ReviewStop> = reviewStopFile.map((file) => {
  const { $schema: _schema, ...rest } = file;
  return rest;
});
const lastCloseArb: fc.Arbitrary<LastClose> = reviewStopFile
  .map((file) => file.lastClose)
  .filter((close): close is LastClose => close !== null);

const stopCause: fc.Arbitrary<StopCause> = fc.constantFrom("declared", "held");

const closedBy = fc.record({ name: word, email: word });
const acceptanceStep = fc.constantFrom("authored", "none");

// --- Event registry ----------------------------------------------------------------------------

type EventOf<K extends PhaxEventType> = Extract<PhaxEvent, { type: K }>;

const event = <K extends PhaxEventType, F extends object>(
  type: K,
  fields: fc.Arbitrary<F>,
): fc.Arbitrary<EventOf<K>> =>
  fc.tuple(baseFields, fields).map(([b, f]) => ({ ...b, ...f, type }) as unknown as EventOf<K>);

const plain = <K extends PhaxEventType>(type: K): fc.Arbitrary<EventOf<K>> =>
  event(type, fc.constant({}));

const failedStepFields = fc.oneof(
  fc.record({
    failedStep: fc.constantFrom("configured", "acceptance"),
    command: text,
    protectedChanges,
  }),
  fc.record({
    failedStep: fc.constant("protected-paths"),
    protectedChanges: nonEmptyProtectedChanges,
  }),
);

const heldClosure = fc.oneof(
  fc.record({
    outcome: fc.constant("corrected"),
    reviewCommit: hash,
    acceptanceStep,
    closedBy,
  }),
  fc.record({ outcome: fc.constant("unchanged"), closedBy }),
);

const declaredClosure = fc.oneof(
  fc.record({ outcome: fc.constant("corrected"), acceptanceStep, closedBy }),
  fc.record({ outcome: fc.constant("unchanged"), closedBy }),
);

export const EVENT_GENERATORS: {
  readonly [K in PhaxEventType]: fc.Arbitrary<EventOf<K>>;
} = {
  RunStarted: plain("RunStarted"),
  RunResumeRequested: plain("RunResumeRequested"),
  RunInterruptRequested: plain("RunInterruptRequested"),
  RunArchiveRequested: event(
    "RunArchiveRequested",
    fc.record({
      force: fc.boolean(),
      from: word,
      to: word,
      worktreesFrom: optional(word),
      worktreesTo: optional(word),
    }),
  ),
  RunFailed: event("RunFailed", fc.record({ cause: runFailedCause })),
  FinalReviewOpened: event("FinalReviewOpened", fc.record({ info: reviewInfo })),
  RunCompleted: plain("RunCompleted"),
  PhaseStartRequested: event("PhaseStartRequested", fc.record({ phaseId })),
  WorktreeCreated: event("WorktreeCreated", fc.record({ path: worktreePath })),
  AgentInvocationStarted: plain("AgentInvocationStarted"),
  AgentInvocationCompleted: event("AgentInvocationCompleted", fc.record({ sessionId })),
  GateStarted: event("GateStarted", fc.record({ attempt })),
  GatePassed: event("GatePassed", fc.record({ attempt })),
  GateFailed: fc
    .tuple(
      baseFields,
      fc.record({ logPath: word, attempt, exitCode: fc.integer({ min: 1, max: 255 }) }),
      failedStepFields,
    )
    .map(([b, f, step]) => {
      const { exitCode, ...rest } = f;
      return {
        ...b,
        ...rest,
        ...step,
        ...(step.failedStep === "protected-paths" ? {} : { exitCode }),
        type: "GateFailed",
      } as unknown as EventOf<"GateFailed">;
    }),
  FixStarted: event("FixStarted", fc.record({ attempt })),
  FixCompleted: event("FixCompleted", fc.record({ sessionId })),
  FixAttemptsExhausted: fc
    .tuple(
      baseFields,
      fc.record({
        attempt,
        phaseId,
        worktreePath,
        sessionId,
        lastFixTranscript: fc.option(word, { nil: null }),
      }),
      failedStepFields,
    )
    .map(
      ([b, f, step]) =>
        ({
          ...b,
          ...f,
          ...step,
          type: "FixAttemptsExhausted",
        }) as unknown as EventOf<"FixAttemptsExhausted">,
    ),
  GateStepRefused: event(
    "GateStepRefused",
    fc.record({
      attempt,
      phaseId,
      worktreePath,
      sessionId,
      command: text,
      reason: text,
      remedy: text,
      failedStep: fc.constantFrom("configured", "acceptance"),
      protectedChanges,
    }),
  ),
  HandoffRequested: plain("HandoffRequested"),
  HandoffValidated: plain("HandoffValidated"),
  HandoffMissing: event(
    "HandoffMissing",
    fc.record({ missingSections: fc.array(word, { maxLength: 4 }) }),
  ),
  CommitCreated: event("CommitCreated", fc.record({ hash })),
  CommitFailed: event(
    "CommitFailed",
    fc.record({ phaseId, worktreePath, sessionId, reason: text }),
  ),
  CleanupFailed: event("CleanupFailed", fc.record({ phaseId, worktreePath, reason: text })),
  CleanupStarted: plain("CleanupStarted"),
  CleanupCompleted: plain("CleanupCompleted"),
  PhaseHadNoChanges: event(
    "PhaseHadNoChanges",
    fc.record({ phaseId, worktreePath, sessionId, reason: text }),
  ),
  ArtifactCompletionFailed: event(
    "ArtifactCompletionFailed",
    fc.record({ phaseId, worktreePath, reason: text }),
  ),
  RateLimitDetected: fc
    .tuple(
      baseFields,
      limitError,
      fc.record({
        kind: fc.constantFrom("rate_limit", "usage_limit"),
        resetAt: optional(timestamp),
        worktreePath: optional(worktreePath),
        sessionId: optional(sessionId),
      }),
    )
    .map(
      ([b, cause, f]) =>
        ({
          ...b,
          ...f,
          cause,
          type: "RateLimitDetected",
        }) as unknown as EventOf<"RateLimitDetected">,
    ),
  NetworkFailureDetected: event(
    "NetworkFailureDetected",
    fc.record({
      cause: agentSessionFailedError,
      worktreePath: optional(worktreePath),
      sessionId: optional(sessionId),
    }),
  ),
  HandoffTurnFailed: event("HandoffTurnFailed", fc.record({ cause: agentSessionFailedError })),
  HandoffProtectedPathsChanged: event(
    "HandoffProtectedPathsChanged",
    fc.record({ changes: nonEmptyProtectedChanges, worktreePath }),
  ),
  PhaseResetRequested: event("PhaseResetRequested", fc.record({ phaseId })),
  ReviewStopReached: event(
    "ReviewStopReached",
    reviewStopArb.chain((rs) =>
      fc.record({
        phaseId,
        // Equal to the stop's cause or not: the reducer answers `Unexpected` on a mismatch.
        cause: fc.oneof(fc.constant(rs.cause), stopCause),
        worktreePath,
        reviewStop: fc.constant(rs),
      }),
    ),
  ),
  StopCloseRefused: event("StopCloseRefused", fc.record({ phaseId, lastClose: lastCloseArb })),
  StopCommitted: event("StopCommitted", fc.record({ phaseId, hash, closure: declaredClosure })),
  HeldStopClosed: event(
    "HeldStopClosed",
    fc.record({ phaseId, phaseCommit: hash, closure: heldClosure }),
  ),
  HoldPointFailed: event(
    "HoldPointFailed",
    fc.record({ phaseId, phaseCommit: hash, worktreePath, reason: text }),
  ),
  StopRecordRefused: event(
    "StopRecordRefused",
    fc.record({ phaseId, cause: stopCause, phaseCommit: hash, worktreePath, reason: text }),
  ),
};

/** The event types with no registry entry, in the order given. */
export const missingEventGenerators = (types: ReadonlyArray<string>): ReadonlyArray<string> =>
  types.filter((type) => !Object.hasOwn(EVENT_GENERATORS, type));

/** Any event of any type. */
export const anyEvent = (): fc.Arbitrary<PhaxEvent> =>
  fc.oneof(...(Object.values(EVENT_GENERATORS) as fc.Arbitrary<PhaxEvent>[]));

/**
 * Events biased toward `types`: four draws in five are of one of them, the fifth is any event. A
 * property about what a handled event leads to checks nothing on a refusal, and `anyEvent` picks
 * the few handled types too rarely; any event stays in the mix so the refusals are still searched.
 */
export const eventsBiasedTo = (types: ReadonlyArray<PhaxEventType>): fc.Arbitrary<PhaxEvent> =>
  types.length === 0
    ? anyEvent()
    : fc.oneof(
        {
          weight: 4,
          arbitrary: fc.oneof(
            ...types.map((type) => EVENT_GENERATORS[type] as fc.Arbitrary<PhaxEvent>),
          ),
        },
        { weight: 1, arbitrary: anyEvent() },
      );

// --- Phase sub-state fillers -------------------------------------------------------------------

type SubOf<K extends PhaseSubStateName> = Extract<PhaseSubState, { state: K }>;

const bare = <K extends PhaseSubStateName>(state: K): fc.Arbitrary<SubOf<K>> =>
  fc.constant({ state } as unknown as SubOf<K>);

export const PHASE_SUB_STATE_FILLERS: {
  readonly [K in PhaseSubStateName]: fc.Arbitrary<SubOf<K>>;
} = {
  pending: bare("pending"),
  setting_up_worktree: bare("setting_up_worktree"),
  running: bare("running"),
  gates_failed: attempt.map((a) => ({ state: "gates_failed", attempt: a }) as const),
  gates_exhausted: attempt.map((a) => ({ state: "gates_exhausted", attempt: a }) as const),
  fixing: attempt.map((a) => ({ state: "fixing", attempt: a }) as const),
  passed: bare("passed"),
  committed: hash.map((h) => ({ state: "committed", hash: h }) as const),
  cleaning_up: bare("cleaning_up"),
  cleaned_up: bare("cleaned_up"),
  handoff_failed: fc
    .array(word, { maxLength: 3 })
    .map((missing) => ({ state: "handoff_failed", missing }) as const),
  failed: text.map((cause) => ({ state: "failed", cause }) as const),
  skipped: bare("skipped"),
  rate_limited: bare("rate_limited"),
  review_open: bare("review_open"),
  awaiting_review: stopCause.map((cause) => ({ state: "awaiting_review", cause }) as const),
};

// --- Shapes ------------------------------------------------------------------------------------

/** A state with its free fields (`hash`, `attempt`, `missing`, `cause`) left out. */
export interface Shape {
  readonly run: PhaxStateName;
  readonly phase?: PhaseSubStateName;
  readonly stopCause?: StopCause;
}

/** The abstract shape of a state. */
export const shapeOf = (state: PhaxState): Shape => {
  if (!("phase" in state)) return { run: state.run };
  const stop = state.phase.state === "awaiting_review" ? { stopCause: state.phase.cause } : {};
  return { run: state.run, phase: state.phase.state, ...stop };
};

/** A shape as a sortable key. */
export const shapeKey = (shape: Shape): string =>
  [shape.run, shape.phase ?? "-", shape.stopCause ?? "-"].join("/");

/** A named starting point of the reachability closure. */
export interface ReachabilitySeed {
  readonly name: string;
  readonly reason: string;
  readonly state: PhaxState;
}

/**
 * The closure of `interpret` from two seeds: `created`, where every run starts, and `stopped`. No
 * transition enters `stopped`, yet a run-status from an older release holds it and
 * `composePhaxState` composes it.
 */
export const REACHABILITY_SEEDS: ReadonlyArray<ReachabilitySeed> = [
  { name: "created", reason: "where every run starts", state: { run: "created" } },
  {
    name: "stopped",
    reason: "no transition enters it, but an older release's run-status holds it",
    state: { run: "stopped" },
  },
];

/**
 * Breadth-first closure over abstract shapes: from one representative state per shape, every event
 * is interpreted and each `Handled` next state whose shape is new joins the frontier.
 */
export const reducerClosure = (
  seeds: ReadonlyArray<PhaxState>,
  events: ReadonlyArray<PhaxEvent>,
): ReadonlyArray<Shape> => {
  const seen = new Map<string, Shape>();
  const queue: PhaxState[] = [];
  const visit = (state: PhaxState): void => {
    const key = shapeKey(shapeOf(state));
    if (seen.has(key)) return;
    seen.set(key, shapeOf(state));
    queue.push(state);
  };
  for (const seed of seeds) visit(seed);
  for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
    for (const e of events) {
      const d = interpret(state, e);
      if (d.kind === "Handled") visit(d.nextState);
    }
  }
  return [...seen.values()];
};

/**
 * The run's reachable abstract shapes, reviewed by hand: the closure of `interpret` from
 * `REACHABILITY_SEEDS` (`created` and `stopped`). A sanity test recomputes the closure and must
 * equal this table. It leaves out, among others: every `failed` phase sub-state (a failed run
 * carries a cause, no phase), `running` with `gates_exhausted` (the reducer pauses the run as
 * `interrupted` there), `interrupted` with `review_open` or `awaiting_review` (those stops have a
 * run state of their own), and `rate_limited` with any phase but `rate_limited`. A state only
 * inconsistent persisted files compose is never generated.
 */
export const REACHABLE_SHAPES: ReadonlyArray<Shape> = [
  { run: "archived" },
  { run: "awaiting_review", phase: "awaiting_review", stopCause: "declared" },
  { run: "awaiting_review", phase: "awaiting_review", stopCause: "held" },
  { run: "completed" },
  { run: "created" },
  { run: "failed" },
  { run: "interrupted", phase: "cleaned_up" },
  { run: "interrupted", phase: "cleaning_up" },
  { run: "interrupted", phase: "committed" },
  { run: "interrupted", phase: "fixing" },
  { run: "interrupted", phase: "gates_exhausted" },
  { run: "interrupted", phase: "gates_failed" },
  { run: "interrupted", phase: "handoff_failed" },
  { run: "interrupted", phase: "passed" },
  { run: "interrupted", phase: "pending" },
  { run: "interrupted", phase: "rate_limited" },
  { run: "interrupted", phase: "running" },
  { run: "interrupted", phase: "setting_up_worktree" },
  { run: "interrupted", phase: "skipped" },
  { run: "rate_limited", phase: "rate_limited" },
  { run: "review_open", phase: "review_open" },
  { run: "running", phase: "awaiting_review", stopCause: "declared" },
  { run: "running", phase: "awaiting_review", stopCause: "held" },
  { run: "running", phase: "cleaned_up" },
  { run: "running", phase: "cleaning_up" },
  { run: "running", phase: "committed" },
  { run: "running", phase: "fixing" },
  { run: "running", phase: "gates_failed" },
  { run: "running", phase: "handoff_failed" },
  { run: "running", phase: "passed" },
  { run: "running", phase: "pending" },
  { run: "running", phase: "rate_limited" },
  { run: "running", phase: "running" },
  { run: "running", phase: "setting_up_worktree" },
  { run: "running", phase: "skipped" },
  { run: "stopped" },
];

/** A state with its origin: the key of the shape it was drawn from. */
export interface SourcedState {
  readonly origin: string;
  readonly state: PhaxState;
}

const fillShape = (shape: Shape): fc.Arbitrary<SourcedState> => {
  const origin = shapeKey(shape);
  const sourced = (state: PhaxState): SourcedState => ({ origin, state });
  switch (shape.run) {
    case "created":
    case "completed":
    case "stopped":
    case "archived":
      return fc.constant(sourced({ run: shape.run }));
    case "failed":
      return text.map((cause) => sourced({ run: "failed", cause }));
    case "review_open":
      return fc.constant(sourced({ run: "review_open", phase: { state: "review_open" } }));
    case "awaiting_review":
      return PHASE_SUB_STATE_FILLERS.awaiting_review.map((phase) =>
        sourced({
          run: "awaiting_review",
          phase: { state: "awaiting_review", cause: shape.stopCause ?? phase.cause },
        }),
      );
    case "running":
    case "rate_limited":
    case "interrupted": {
      const run = shape.run;
      const name = shape.phase ?? "pending";
      const filler: fc.Arbitrary<PhaseSubState> =
        name === "awaiting_review" && shape.stopCause !== undefined
          ? fc.constant<PhaseSubState>({ state: "awaiting_review", cause: shape.stopCause })
          : PHASE_SUB_STATE_FILLERS[name];
      return filler.map((phase) => sourced({ run, phase }));
    }
  }
};

const fromShapes = (shapes: ReadonlyArray<Shape>): fc.Arbitrary<SourcedState> =>
  fc.oneof(...shapes.map(fillShape));

/** A reachable state: a shape of the table, its free fields filled at random. */
export const reachableStates = (): fc.Arbitrary<SourcedState> => fromShapes(REACHABLE_SHAPES);

/** A reachable state of one of these run states. */
export const statesOfRun = (...runs: PhaxStateName[]): fc.Arbitrary<SourcedState> =>
  fromShapes(REACHABLE_SHAPES.filter((shape) => runs.includes(shape.run)));

/** A reachable state whose phase sub-state is terminal. */
export const terminalPhaseStates = (): fc.Arbitrary<SourcedState> =>
  fromShapes(
    REACHABLE_SHAPES.filter(
      (shape) => shape.phase !== undefined && TERMINAL_PHASE_STATES.has(shape.phase),
    ),
  );

// The seed of the sample that finds the event types a set of states handles: fixed, so the bias
// is the same on every run.
const HANDLED_SEED = 20_261_116;
const HANDLED_STATES = 100;
const HANDLED_EVENTS_PER_TYPE = 10;

/** The event types `interpret` handles from at least one state of `states`, read from the reducer
 *  over a fixed-seed sample of the states and of each type's events. */
export const handledEventTypes = (
  states: fc.Arbitrary<SourcedState>,
): ReadonlyArray<PhaxEventType> => {
  const sample = fc.sample(states, { numRuns: HANDLED_STATES, seed: HANDLED_SEED });
  return (Object.keys(EVENT_GENERATORS) as PhaxEventType[]).filter((type) => {
    const events = fc.sample(EVENT_GENERATORS[type] as fc.Arbitrary<PhaxEvent>, {
      numRuns: HANDLED_EVENTS_PER_TYPE,
      seed: HANDLED_SEED,
    });
    return sample.some(({ state }) =>
      events.some((each) => interpret(state, each).kind === "Handled"),
    );
  });
};
