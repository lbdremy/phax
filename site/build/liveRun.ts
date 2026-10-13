// The run the home page plays in its hero: a spec and a plan approved, a
// three-phase run whose second phase fails its gate once and fixes it, the
// compliance review and the pull request. Only the order of events is written
// here; every status comes from phax's own domain. The artifact statuses go
// through requestTransition and the run's states through the reducer, so a
// transition the state machine no longer allows fails the build instead of
// showing on the site.
import { Either } from "effect";
import {
  requestTransition,
  type ArtifactKind,
  type StatusFor,
} from "../../src/domain/artifact/status.js";
import {
  decodeBranchName,
  decodeClaudeSessionId,
  decodePhaseId,
  decodeRunId,
  decodeWorktreePath,
  type PhaseId,
} from "../../src/domain/branded.js";
import type { PhaxEvent } from "../../src/domain/events.js";
import { interpret } from "../../src/domain/reducer.js";
import type { PhaxState } from "../../src/domain/state.js";
import type { Verdict } from "../../src/schemas/complianceReview.js";

/** Where a line belongs on the card's stepper. */
export type LiveRunStage = "spec" | "plan" | "run" | "review" | "pr";

/** One line of the card's log, with the state it leaves the card in. */
export interface LiveRunLine {
  readonly stage: LiveRunStage;
  /** The semantic event type (`state.transition`, `gate.evaluated`…), or `artifact` for a status change. */
  readonly kind: string;
  /** The event, the artifact or what happened. */
  readonly label: string;
  /** `state.transition` and `artifact` lines: the state before (absent for a new artifact) and after. */
  readonly before?: string;
  readonly after?: string;
  readonly phase?: string;
  readonly attempt?: number;
  readonly failed?: boolean;
}

export const LIVE_RUN_NAME = "greet";
export const LIVE_RUN_PHASES = ["phase-01", "phase-02", "phase-03"] as const;
const VERDICT: Verdict = "conformant";

function decoded<A, E>(value: Either.Either<A, E>, what: string): A {
  if (Either.isLeft(value)) throw new Error(`live run: ${what} does not decode`);
  return value.right;
}

/** `running:pending`, as phax's semantic trace writes a state. */
function stateLabel(state: PhaxState): string {
  return "phase" in state ? `${state.run}:${state.phase.state}` : state.run;
}

function artifactLine<K extends ArtifactKind>(
  stage: LiveRunStage,
  kind: K,
  from: StatusFor<K>,
  to: StatusFor<K>,
): LiveRunLine {
  const result = requestTransition(kind, from, to);
  if (Either.isLeft(result)) {
    throw new Error(`live run: ${kind} ${from} → ${to} is not an artifact transition phax allows`);
  }
  return { stage, kind: "artifact", label: `${kind} ${LIVE_RUN_NAME}`, before: from, after: to };
}

/** The run's events, phase by phase; `fail` makes a phase's first gate attempt fail. */
function runEvents(): ReadonlyArray<{
  readonly event: PhaxEvent;
  readonly gate?: "passed" | "failed";
}> {
  const run = decoded(decodeRunId(`docs.${LIVE_RUN_NAME}`), "the run id");
  const session = decoded(decodeClaudeSessionId("session"), "the session id");
  let sequence = 0;
  const base = (phase?: PhaseId) => ({
    eventId: `event-${String(++sequence).padStart(3, "0")}`,
    occurredAt: "2026-01-01T00:00:00.000Z",
    run,
    ...(phase === undefined ? {} : { phase }),
  });
  const events: Array<{ event: PhaxEvent; gate?: "passed" | "failed" }> = [
    { event: { ...base(), type: "RunStarted" } },
  ];
  LIVE_RUN_PHASES.forEach((id, index) => {
    const phaseId = decoded(decodePhaseId(id), id);
    const path = decoded(decodeWorktreePath(`worktrees/${id}`), "a worktree path");
    const last = index === LIVE_RUN_PHASES.length - 1;
    const push = (event: PhaxEvent, gate?: "passed" | "failed") =>
      events.push(gate === undefined ? { event } : { event, gate });
    push({ ...base(phaseId), type: "PhaseStartRequested", phaseId });
    push({ ...base(phaseId), type: "WorktreeCreated", path });
    push({ ...base(phaseId), type: "AgentInvocationStarted" });
    push({ ...base(phaseId), type: "AgentInvocationCompleted", sessionId: session });
    if (index === 1) {
      push({ ...base(phaseId), type: "GateStarted", attempt: 1 });
      push(
        {
          ...base(phaseId),
          type: "GateFailed",
          command: "pnpm test",
          exitCode: 1,
          logPath: "checks-attempt-01.log",
          attempt: 1,
        },
        "failed",
      );
      push({ ...base(phaseId), type: "FixStarted", attempt: 1 });
      push({ ...base(phaseId), type: "FixCompleted", sessionId: session });
    }
    const attempt = index === 1 ? 2 : 1;
    push({ ...base(phaseId), type: "GateStarted", attempt });
    push({ ...base(phaseId), type: "GatePassed", attempt }, "passed");
    push({ ...base(phaseId), type: "HandoffValidated" });
    push({ ...base(phaseId), type: "CommitCreated", hash: `c0ffee${index + 1}` });
    if (!last) {
      push({ ...base(phaseId), type: "CleanupStarted" });
      push({ ...base(phaseId), type: "CleanupCompleted" });
    }
  });
  const finalPhase = LIVE_RUN_PHASES.at(-1) ?? "phase-03";
  events.push({
    event: {
      ...base(decoded(decodePhaseId(finalPhase), finalPhase)),
      type: "FinalReviewOpened",
      info: {
        namespace: "docs",
        shortName: LIVE_RUN_NAME,
        runId: `docs.${LIVE_RUN_NAME}`,
        runState: "review_open",
        branch: `phax/${LIVE_RUN_NAME}`,
        runTitle: undefined,
        finalPhaseBranch: decoded(
          decodeBranchName(`phax/${LIVE_RUN_NAME}--${finalPhase}`),
          "the final branch",
        ),
        stateRoot: "state",
        runPath: `state/runs/docs.${LIVE_RUN_NAME}`,
        finalPhaseId: finalPhase,
        finalPhaseTitle: finalPhase,
        worktreePath: `worktrees/${finalPhase}`,
        claudeSessionId: undefined,
        gateProfileId: undefined,
        phaseStatuses: [],
        planPhases: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        stoppedReason: undefined,
        lastError: undefined,
      },
    },
  });
  return events;
}

/** The run's lines: every event through the reducer, which must handle it. */
function runLines(): ReadonlyArray<LiveRunLine> {
  let state: PhaxState = { run: "created" };
  const lines: Array<LiveRunLine> = [];
  for (const { event, gate } of runEvents()) {
    const disposition = interpret(state, event);
    if (disposition.kind !== "Handled") {
      throw new Error(
        `live run: the reducer answers ${disposition.kind} to ${event.type} in ${stateLabel(state)}`,
      );
    }
    const phase = event.phase === undefined ? {} : { phase: event.phase as string };
    const attempt = "attempt" in event ? { attempt: event.attempt } : {};
    if (gate !== undefined) {
      lines.push({
        stage: "run",
        kind: "gate.evaluated",
        label: gate,
        ...phase,
        ...attempt,
        ...(gate === "failed" ? { failed: true } : {}),
      });
    }
    const before = stateLabel(state);
    const after = stateLabel(disposition.nextState);
    state = disposition.nextState;
    // Events the reducer handles without changing the state are not transitions.
    if (before === after) continue;
    lines.push({
      stage: event.type === "FinalReviewOpened" ? "review" : "run",
      kind: "state.transition",
      label: event.type,
      before,
      after,
      ...phase,
      ...attempt,
      ...(event.type === "GateFailed" ? { failed: true } : {}),
    });
  }
  return lines;
}

/** The whole golden path, in order. */
export function liveRun(): ReadonlyArray<LiveRunLine> {
  const run = runLines();
  const reviewOpened = run.findIndex((line) => line.label === "FinalReviewOpened");
  return [
    { stage: "spec", kind: "artifact", label: `spec ${LIVE_RUN_NAME}`, after: "Draft" },
    artifactLine("spec", "spec", "Draft", "Approved"),
    { stage: "plan", kind: "artifact", label: `plan ${LIVE_RUN_NAME}`, after: "Draft" },
    { stage: "plan", kind: "step.completed", label: "plans lint · 0 findings" },
    artifactLine("plan", "plan", "Draft", "Approved"),
    ...run.slice(0, reviewOpened),
    // The run completes its plan, and the spec it is the last plan of, on its own branch.
    artifactLine("run", "plan", "Approved", "Completed"),
    artifactLine("run", "spec", "Approved", "Completed"),
    ...run.slice(reviewOpened),
    { stage: "review", kind: "artifact.generated", label: `compliance-review.md · ${VERDICT}` },
    { stage: "pr", kind: "step.completed", label: "publish-pr · pull request opened" },
  ];
}
