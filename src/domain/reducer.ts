import type { Disposition } from "./disposition.js";
import type { PhaxCommand } from "./effects.js";
import type { FixAttemptsExhausted, PhaxEvent } from "./events.js";
import type { PhaxState, StopCause } from "./state.js";
import type { LastClose } from "../schemas/reviewStop.js";
import { AgentInvocationError } from "./errors.js";

const handled = (
  nextState: PhaxState,
  effects: readonly PhaxCommand[] = [],
): Disposition<PhaxState> => ({ kind: "Handled", nextState, effects });

const ignored = (reason: string): Disposition<PhaxState> => ({ kind: "Ignored", reason });
const stale = (reason: string): Disposition<PhaxState> => ({ kind: "Stale", reason });
const rejected = (reason: string): Disposition<PhaxState> => ({ kind: "Rejected", reason });
const unexpected = (reason: string): Disposition<PhaxState> => ({ kind: "Unexpected", reason });

/** The run's `lastError` for an exhausted fix loop: the failed command, or the protected paths. */
function exhaustedLastError(event: FixAttemptsExhausted): string {
  return event.failedStep === "protected-paths"
    ? `Gate failed: protected paths changed (${event.protectedChanges.map((change) => change.path).join(", ")})`
    : `Gate failed: ${event.command}`;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled discriminator: ${JSON.stringify(x)}`);
}

export function describeCause(cause: unknown): string {
  if (cause == null) return "unknown";
  if (typeof cause === "string") return cause;
  if (cause instanceof AgentInvocationError) {
    const raw = cause.stderrExcerpt ?? cause.stderr;
    if (raw) {
      const bounded = raw.slice(-500).trim();
      if (bounded) return `${cause.message}: ${bounded}`;
    }
    return cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Pure reducer: maps (state, event) to an explicit disposition.
 *
 * The outer switch covers every event type; the inner switch covers every
 * run state. Phase-substate refinement happens inside the run-state arms.
 * Every branch returns explicitly, and each inner switch ends in a
 * `default: return assertNever(state)` clause: when the switch is exhaustive
 * TypeScript narrows `state` to `never` there, so adding a run state without
 * handling it here fails to compile.
 */
export function interpret(state: PhaxState, event: PhaxEvent): Disposition<PhaxState> {
  switch (event.type) {
    case "RunStarted":
      switch (state.run) {
        case "created":
          return handled({ run: "running", phase: { state: "pending" } });
        case "running":
        case "rate_limited":
        case "interrupted":
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`cannot start run from ${state.run}`);
        case "awaiting_review":
          return rejected(`cannot start run from ${state.run}`);
        default:
          return assertNever(state);
      }

    case "RunResumeRequested":
      switch (state.run) {
        case "rate_limited":
          return handled({ run: "running", phase: { state: "running" } });
        case "interrupted":
          if (state.phase.state === "gates_exhausted") {
            return handled({ run: "running", phase: { state: "running" } });
          }
          return handled({ run: "running", phase: state.phase });
        // A close of the stop starts: the phase stays awaiting_review until
        // StopCommitted, so an interruption before the commit returns to the stop.
        case "awaiting_review":
          return handled({ run: "running", phase: state.phase }, [
            {
              type: "PersistState",
              patch: { phase: { stop: { cause: state.phase.cause, status: "waiting" } } },
            },
            { type: "ParkReviewStop" },
          ]);
        case "running":
          return ignored("run is already running");
        case "created":
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`cannot resume run from ${state.run}`);
        default:
          return assertNever(state);
      }

    case "RunInterruptRequested":
      switch (state.run) {
        case "running":
          // An interrupted close returns to the stop it was closing.
          if (state.phase.state === "awaiting_review") {
            return stopReturned(state.phase, event.phase, {
              result: "interrupted",
              at: event.occurredAt,
              exitCode: 130,
            });
          }
          return handled({ run: "interrupted", phase: state.phase });
        case "rate_limited":
          return handled({ run: "interrupted", phase: state.phase });
        case "interrupted":
          return ignored("run is already interrupted");
        case "awaiting_review":
          return ignored("nothing is running while the run awaits review");
        case "created":
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`cannot interrupt run from ${state.run}`);
        default:
          return assertNever(state);
      }

    case "RunArchiveRequested": {
      const archiveEffects: readonly PhaxCommand[] = [
        { type: "MoveRunToArchive", from: event.from, to: event.to },
        ...(event.worktreesFrom !== undefined && event.worktreesTo !== undefined
          ? [
              {
                type: "MoveRunToArchive" as const,
                from: event.worktreesFrom,
                to: event.worktreesTo,
              },
            ]
          : []),
      ];
      switch (state.run) {
        case "review_open":
        case "completed":
          return handled({ run: "archived" }, archiveEffects);
        case "created":
        case "failed":
        case "interrupted":
        case "rate_limited":
        case "stopped":
          return event.force
            ? handled({ run: "archived" }, archiveEffects)
            : rejected(`run is ${state.run}, not finished; pass --force to archive it anyway`);
        // review-stop.json goes before the run folder moves.
        case "awaiting_review":
          return event.force
            ? handled({ run: "archived" }, [{ type: "DiscardReviewStop" }, ...archiveEffects])
            : rejected(`run is ${state.run}, not finished; pass --force to archive it anyway`);
        case "archived":
          return rejected("run is already archived");
        case "running":
          return rejected("cannot archive a running run");
        default:
          return assertNever(state);
      }
    }

    case "RunFailed":
      switch (state.run) {
        case "running":
        case "rate_limited":
        case "interrupted":
          return handled({ run: "failed", cause: describeCause(event.cause) });
        case "failed":
          return ignored("run is already failed");
        case "created":
        case "review_open":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`cannot fail run from ${state.run}`);
        case "awaiting_review":
          return rejected(`cannot fail run from ${state.run}`);
        default:
          return assertNever(state);
      }

    case "FinalReviewOpened":
      switch (state.run) {
        case "running":
        case "interrupted": {
          const ps = state.phase.state;
          if (
            ps === "committed" ||
            ps === "cleaned_up" ||
            ps === "skipped" ||
            ps === "handoff_failed"
          ) {
            return handled({ run: "review_open", phase: { state: "review_open" } }, [
              { type: "OpenRunReview", info: event.info },
            ]);
          }
          return unexpected(`final review opened while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("final review opened while run is rate_limited");
        case "review_open":
          return ignored("final review is already open");
        case "created":
          return unexpected("final review opened before run started");
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`final review cannot reopen from ${state.run}`);
        case "awaiting_review":
          return rejected(`final review cannot open from ${state.run}`);
        default:
          return assertNever(state);
      }

    case "RunCompleted":
      switch (state.run) {
        case "running":
          return handled({ run: "completed" });
        case "completed":
          return ignored("run is already completed");
        case "created":
          return unexpected("run completed before it started");
        case "rate_limited":
        case "interrupted":
        case "review_open":
        case "failed":
        case "stopped":
        case "archived":
          return rejected(`cannot complete run from ${state.run}`);
        case "awaiting_review":
          return rejected(`cannot complete run from ${state.run}`);
        default:
          return assertNever(state);
      }

    case "PhaseStartRequested":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "pending" || ps === "cleaned_up" || ps === "skipped") {
            return handled({ run: "running", phase: { state: "setting_up_worktree" } });
          }
          if (ps === "setting_up_worktree" || ps === "running") {
            return ignored(`phase already in ${ps}`);
          }
          return rejected(`cannot start a new phase while current phase is ${ps}`);
        }
        case "created":
        case "rate_limited":
        case "interrupted":
        case "review_open":
          return rejected(`cannot start phase while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`phase start requested on ${state.run} run`);
        case "awaiting_review":
          return rejected(`cannot start phase while run is ${state.run}`);
        default:
          return assertNever(state);
      }

    case "WorktreeCreated":
      switch (state.run) {
        case "running": {
          if (state.phase.state === "setting_up_worktree") {
            return handled({ run: "running", phase: { state: "running" } });
          }
          if (state.phase.state === "running") {
            return ignored("worktree already in place; phase already running");
          }
          return unexpected(`worktree created while phase is ${state.phase.state}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("worktree creation event arrived while run was paused");
        case "created":
          return unexpected("worktree created before run started");
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`worktree creation event on ${state.run} run`);
        case "awaiting_review":
          return stale("WorktreeCreated while the run awaits review");
        default:
          return assertNever(state);
      }

    case "AgentInvocationStarted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "running" || ps === "fixing") {
            return handled(state);
          }
          return unexpected(`agent invocation started while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("agent invocation started while run is rate_limited");
        case "interrupted":
          return stale("agent invocation started on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`agent invocation started while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`agent invocation started on ${state.run} run`);
        case "awaiting_review":
          return stale("AgentInvocationStarted while the run awaits review");
        default:
          return assertNever(state);
      }

    case "AgentInvocationCompleted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "running" || ps === "fixing") {
            return handled(state);
          }
          return unexpected(`agent invocation completed while phase is ${ps}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("agent invocation completed on paused/interrupted run");
        case "created":
        case "review_open":
          return unexpected(`agent invocation completed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`agent invocation completed on ${state.run} run`);
        case "awaiting_review":
          return stale("AgentInvocationCompleted while the run awaits review");
        default:
          return assertNever(state);
      }

    case "GateStarted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "running" || ps === "fixing") {
            return handled(state);
          }
          return unexpected(`gate started while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("gate started while run is rate_limited");
        case "interrupted":
          return stale("gate started on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`gate started while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`gate started on ${state.run} run`);
        case "awaiting_review":
          return stale("GateStarted while the run awaits review");
        default:
          return assertNever(state);
      }

    case "GatePassed":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "running" || ps === "fixing") {
            return handled({ run: "running", phase: { state: "passed" } });
          }
          return stale(`gate passed for phase already in ${ps}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("gate result for a paused/interrupted run");
        case "created":
        case "review_open":
          return unexpected(`gate passed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`gate passed on ${state.run} run`);
        case "awaiting_review":
          return stale("GatePassed while the run awaits review");
        default:
          return assertNever(state);
      }

    case "GateFailed":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "running" || ps === "fixing") {
            return handled({
              run: "running",
              phase: { state: "gates_failed", attempt: event.attempt },
            });
          }
          return stale(`gate failed for phase already in ${ps}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("gate result for a paused/interrupted run");
        case "created":
        case "review_open":
          return unexpected(`gate failed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`gate failed on ${state.run} run`);
        case "awaiting_review":
          return stale("GateFailed while the run awaits review");
        default:
          return assertNever(state);
      }

    case "FixStarted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "gates_failed") {
            return handled({
              run: "running",
              phase: { state: "fixing", attempt: event.attempt },
            });
          }
          return unexpected(`fix started while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("fix started while run is rate_limited");
        case "interrupted":
          return stale("fix started on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`fix started while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`fix started on ${state.run} run`);
        case "awaiting_review":
          return stale("FixStarted while the run awaits review");
        default:
          return assertNever(state);
      }

    case "FixCompleted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "fixing") {
            return handled({ run: "running", phase: { state: "running" } });
          }
          return unexpected(`fix completed while phase is ${ps}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("fix completed on paused/interrupted run");
        case "created":
        case "review_open":
          return unexpected(`fix completed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`fix completed on ${state.run} run`);
        case "awaiting_review":
          return stale("FixCompleted while the run awaits review");
        default:
          return assertNever(state);
      }

    case "FixAttemptsExhausted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "gates_failed" || ps === "fixing") {
            return handled(
              {
                run: "interrupted",
                phase: { state: "gates_exhausted", attempt: event.attempt },
              },
              [
                {
                  type: "PersistState",
                  patch: {
                    run: {
                      stoppedReason: "gates_exhausted",
                      lastError: exhaustedLastError(event),
                    },
                  },
                },
                {
                  type: "WriteResumeInstructions",
                  ctx: {
                    reason: "Gate checks failed",
                    kind: "gates_exhausted",
                    phaseId: event.phaseId,
                    worktreePath: event.worktreePath as string,
                    sessionId: event.sessionId as string,
                    failedStep: event.failedStep,
                    protectedChanges: event.protectedChanges,
                    lastFixTranscript: event.lastFixTranscript,
                  },
                },
                {
                  type: "EmitTrace",
                  name: "gate.attempts_exhausted",
                  status: "failed",
                  boundary: "gate",
                  details: {
                    phaseId: event.phaseId,
                    attempt: event.attempt,
                    ...(event.failedStep === "protected-paths"
                      ? { protectedPaths: event.protectedChanges.map((change) => change.path) }
                      : { command: event.command }),
                  },
                },
                {
                  type: "EmitTrace",
                  name: "resume.available",
                  status: "info",
                  boundary: "resume-instructions.md",
                  details: { resumeCommand: `phax resume ${event.run}` },
                },
              ],
            );
          }
          return unexpected(`fix attempts exhausted while phase is ${ps}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("fix attempts exhausted on paused/interrupted run");
        case "created":
        case "review_open":
          return unexpected(`fix attempts exhausted while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`fix attempts exhausted on ${state.run} run`);
        case "awaiting_review":
          return stale("FixAttemptsExhausted while the run awaits review");
        default:
          return assertNever(state);
      }

    // A refusal reuses the exhaustion pause: same phase state and stop reason,
    // its own lastError, resume instructions and trace.
    case "GateStepRefused":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "gates_failed") {
            return handled(
              {
                run: "interrupted",
                phase: { state: "gates_exhausted", attempt: event.attempt },
              },
              [
                {
                  type: "PersistState",
                  patch: {
                    run: {
                      stoppedReason: "gates_exhausted",
                      lastError: `Gate step refused: ${event.command} — ${event.reason}`,
                    },
                  },
                },
                {
                  type: "WriteResumeInstructions",
                  ctx: {
                    reason: "Gate step refused",
                    kind: "gate_refused",
                    phaseId: event.phaseId,
                    worktreePath: event.worktreePath as string,
                    sessionId: event.sessionId as string,
                    failedStep: event.failedStep,
                    protectedChanges: event.protectedChanges,
                    refusal: {
                      command: event.command,
                      reason: event.reason,
                      remedy: event.remedy,
                    },
                  },
                },
                {
                  type: "EmitTrace",
                  name: "gate.refused",
                  status: "failed",
                  boundary: "gate",
                  details: {
                    phaseId: event.phaseId,
                    attempt: event.attempt,
                    command: event.command,
                    reason: event.reason,
                    remedy: event.remedy,
                  },
                },
                {
                  type: "EmitTrace",
                  name: "resume.available",
                  status: "info",
                  boundary: "resume-instructions.md",
                  details: { resumeCommand: `phax resume ${event.run}` },
                },
              ],
            );
          }
          return unexpected(`gate step refused while phase is ${ps}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("gate step refused on paused/interrupted run");
        case "created":
        case "review_open":
          return unexpected(`gate step refused while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`gate step refused on ${state.run} run`);
        case "awaiting_review":
          return stale("GateStepRefused while the run awaits review");
        default:
          return assertNever(state);
      }

    case "HandoffRequested":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled(state);
          }
          return unexpected(`handoff requested while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("handoff requested while run is rate_limited");
        case "interrupted":
          return stale("handoff requested on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`handoff requested while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`handoff requested on ${state.run} run`);
        case "awaiting_review":
          return stale("HandoffRequested while the run awaits review");
        default:
          return assertNever(state);
      }

    case "HandoffValidated":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled(state);
          }
          return unexpected(`handoff validated while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("handoff validated while run is rate_limited");
        case "interrupted":
          return stale("handoff validated on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`handoff validated while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`handoff validated on ${state.run} run`);
        case "awaiting_review":
          return stale("HandoffValidated while the run awaits review");
        default:
          return assertNever(state);
      }

    case "HandoffMissing":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled({
              run: "running",
              phase: { state: "handoff_failed", missing: event.missingSections },
            });
          }
          if (ps === "committed") {
            return handled({
              run: "interrupted",
              phase: { state: "handoff_failed", missing: event.missingSections },
            });
          }
          // A second handoff failure during resume-from-handoff: pause again.
          if (ps === "handoff_failed") {
            return handled({
              run: "interrupted",
              phase: { state: "handoff_failed", missing: event.missingSections },
            });
          }
          return unexpected(`handoff missing while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("handoff missing while run is rate_limited");
        case "interrupted":
          return stale("handoff missing on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`handoff missing while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`handoff missing on ${state.run} run`);
        case "awaiting_review":
          return stale("HandoffMissing while the run awaits review");
        default:
          return assertNever(state);
      }

    // HandoffMissing's transitions with no missing section: the handoff turn
    // failed rather than the handoff coming back incomplete, so the failure
    // line is persisted for the person reading run-status.json.
    case "HandoffTurnFailed": {
      const persistFailure: readonly PhaxCommand[] = [
        {
          type: "PersistState",
          patch: {
            run: { stoppedReason: "handoff_turn_failed", lastError: event.cause.message },
          },
        },
      ];
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled(
              { run: "running", phase: { state: "handoff_failed", missing: [] } },
              persistFailure,
            );
          }
          // A failed turn of the handoff, first or on resume: pause.
          if (ps === "committed" || ps === "handoff_failed") {
            return handled(
              { run: "interrupted", phase: { state: "handoff_failed", missing: [] } },
              persistFailure,
            );
          }
          return unexpected(`handoff turn failed while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("handoff turn failed while run is rate_limited");
        case "interrupted":
          return stale("handoff turn failed on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`handoff turn failed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`handoff turn failed on ${state.run} run`);
        case "awaiting_review":
          return stale("HandoffTurnFailed while the run awaits review");
        default:
          return assertNever(state);
      }
    }

    // HandoffMissing's transitions with no missing section: a protected path
    // differs from the phase commit, so the handoff is neither validated nor
    // copied. The paths are persisted as `lastError`, with no new stoppedReason.
    case "HandoffProtectedPathsChanged": {
      const persistAndExplain: readonly PhaxCommand[] = [
        {
          type: "PersistState",
          patch: {
            run: {
              lastError: `Protected paths changed after the commit: ${event.changes.map((change) => change.path).join(", ")}`,
            },
          },
        },
        {
          type: "WriteResumeInstructions",
          ctx: {
            reason: "Protected paths changed after the commit",
            kind: "protected_paths_changed",
            phaseId: event.phase,
            worktreePath: event.worktreePath as string,
            protectedChanges: event.changes,
          },
        },
      ];
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled(
              { run: "running", phase: { state: "handoff_failed", missing: [] } },
              persistAndExplain,
            );
          }
          if (ps === "committed" || ps === "handoff_failed") {
            return handled(
              { run: "interrupted", phase: { state: "handoff_failed", missing: [] } },
              persistAndExplain,
            );
          }
          return unexpected(`protected paths changed after the commit while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("protected paths changed after the commit while run is rate_limited");
        case "interrupted":
          return stale("protected paths changed after the commit on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`protected paths changed after the commit while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`protected paths changed after the commit on ${state.run} run`);
        case "awaiting_review":
          return stale("HandoffProtectedPathsChanged while the run awaits review");
        default:
          return assertNever(state);
      }
    }

    case "CommitCreated":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled({
              run: "running",
              phase: { state: "committed", hash: event.hash },
            });
          }
          return unexpected(`commit created while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("commit created while run is rate_limited");
        case "interrupted":
          return stale("commit created on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`commit created while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`commit created on ${state.run} run`);
        case "awaiting_review":
          return stale("CommitCreated while the run awaits review");
        default:
          return assertNever(state);
      }

    case "CommitFailed":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled({ run: "interrupted", phase: { state: "passed" } }, [
              {
                type: "PersistState",
                patch: {
                  run: { stoppedReason: "commit_failed", lastError: event.reason },
                },
              },
              {
                type: "WriteResumeInstructions",
                ctx: {
                  reason: "Commit failed",
                  kind: "commit_failed",
                  phaseId: event.phase,
                  worktreePath: event.worktreePath as string,
                  sessionId: event.sessionId as string,
                },
              },
              {
                type: "EmitTrace",
                name: "commit.failed",
                status: "failed",
                boundary: "commit",
                details: { phaseId: event.phase, reason: event.reason },
              },
              {
                type: "EmitTrace",
                name: "resume.available",
                status: "info",
                boundary: "resume-instructions.md",
                details: { resumeCommand: `phax resume ${event.run}` },
              },
            ]);
          }
          return unexpected(`commit failed while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("commit failed while run is rate_limited");
        case "interrupted":
          return stale("commit failed on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`commit failed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`commit failed on ${state.run} run`);
        case "awaiting_review":
          return stale("CommitFailed while the run awaits review");
        default:
          return assertNever(state);
      }

    case "CleanupFailed":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "committed" || ps === "cleaning_up") {
            return handled({ run: "interrupted", phase: { state: "cleaning_up" } }, [
              {
                type: "PersistState",
                patch: {
                  run: { stoppedReason: "cleanup_failed", lastError: event.reason },
                },
              },
              {
                type: "WriteResumeInstructions",
                ctx: {
                  reason: "Cleanup failed",
                  kind: "cleanup_failed",
                  phaseId: event.phase,
                  worktreePath: event.worktreePath as string,
                },
              },
              {
                type: "EmitTrace",
                name: "cleanup.failed",
                status: "failed",
                boundary: "cleanup",
                details: { phaseId: event.phase, reason: event.reason },
              },
              {
                type: "EmitTrace",
                name: "resume.available",
                status: "info",
                boundary: "resume-instructions.md",
                details: { resumeCommand: `phax resume ${event.run}` },
              },
            ]);
          }
          return unexpected(`cleanup failed while phase is ${ps}`);
        }
        case "rate_limited":
          return stale("cleanup failed on rate-limited run");
        case "interrupted":
          return stale("cleanup failed on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`cleanup failed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`cleanup failed on ${state.run} run`);
        case "awaiting_review":
          return stale("CleanupFailed while the run awaits review");
        default:
          return assertNever(state);
      }

    case "ArtifactCompletionFailed":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (state.phase.state === "committed") {
            return handled(
              { run: "interrupted", phase: { state: "committed", hash: state.phase.hash } },
              [
                {
                  type: "PersistState",
                  patch: {
                    run: { stoppedReason: "artifact_completion_failed", lastError: event.reason },
                  },
                },
                {
                  type: "WriteResumeInstructions",
                  ctx: {
                    reason: "Artifact completion failed",
                    kind: "artifact_completion_failed",
                    phaseId: event.phase,
                    worktreePath: event.worktreePath as string,
                  },
                },
                {
                  type: "EmitTrace",
                  name: "artifact.completion.failed",
                  status: "failed",
                  boundary: "artifact-completion",
                  details: { phaseId: event.phase, reason: event.reason },
                },
                {
                  type: "EmitTrace",
                  name: "resume.available",
                  status: "info",
                  boundary: "resume-instructions.md",
                  details: { resumeCommand: `phax resume ${event.run}` },
                },
              ],
            );
          }
          return unexpected(`artifact completion failed while phase is ${ps}`);
        }
        case "rate_limited":
          return stale("artifact completion failed on rate-limited run");
        case "interrupted":
          return stale("artifact completion failed on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`artifact completion failed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`artifact completion failed on ${state.run} run`);
        case "awaiting_review":
          return stale("ArtifactCompletionFailed while the run awaits review");
        default:
          return assertNever(state);
      }

    case "CleanupStarted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "committed" || ps === "handoff_failed") {
            return handled({ run: "running", phase: { state: "cleaning_up" } });
          }
          // Idempotent on resume-from-cleanup: phase is already cleaning_up after
          // RunResumeRequested lifts interrupted+cleaning_up → running+cleaning_up.
          if (ps === "cleaning_up") {
            return handled(state);
          }
          return unexpected(`cleanup started while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("cleanup started while run is rate_limited");
        case "interrupted":
          return stale("cleanup started on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`cleanup started while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`cleanup started on ${state.run} run`);
        case "awaiting_review":
          return stale("CleanupStarted while the run awaits review");
        default:
          return assertNever(state);
      }

    case "CleanupCompleted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "cleaning_up") {
            return handled({ run: "running", phase: { state: "cleaned_up" } });
          }
          return unexpected(`cleanup completed while phase is ${ps}`);
        }
        case "rate_limited":
        case "interrupted":
          return stale("cleanup completed on paused/interrupted run");
        case "created":
        case "review_open":
          return unexpected(`cleanup completed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`cleanup completed on ${state.run} run`);
        case "awaiting_review":
          return stale("CleanupCompleted while the run awaits review");
        default:
          return assertNever(state);
      }

    case "PhaseHadNoChanges":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "passed") {
            return handled({ run: "interrupted", phase: { state: "skipped" } }, [
              {
                type: "PersistState",
                patch: {
                  run: { stoppedReason: "no_changes", lastError: event.reason },
                },
              },
              {
                type: "WriteResumeInstructions",
                ctx: {
                  reason: "No changes",
                  kind: "no_changes",
                  phaseId: event.phase,
                  worktreePath: event.worktreePath as string,
                  sessionId: event.sessionId as string,
                },
              },
              {
                type: "EmitTrace",
                name: "phase.no_changes.detected",
                status: "failed",
                boundary: "commit",
                details: { phaseId: event.phase },
              },
              {
                type: "EmitTrace",
                name: "resume.available",
                status: "info",
                boundary: "resume-instructions.md",
                details: { resumeCommand: `phax resume ${event.run}` },
              },
            ]);
          }
          return unexpected(`phase had no changes while phase is ${ps}`);
        }
        case "rate_limited":
          return unexpected("phase had no changes while run is rate_limited");
        case "interrupted":
          return stale("phase had no changes on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`phase had no changes while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`phase had no changes on ${state.run} run`);
        case "awaiting_review":
          return stale("PhaseHadNoChanges while the run awaits review");
        default:
          return assertNever(state);
      }

    case "RateLimitDetected":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          // A close reports a limit with StopCloseRefused.
          if (ps === "awaiting_review") {
            return unexpected("rate limit detected while a close of the stop runs");
          }
          if (ps === "running" || ps === "fixing") {
            const reason: "Rate limit" | "Usage limit" =
              event.kind === "usage_limit" ? "Usage limit" : "Rate limit";
            return handled({ run: "rate_limited", phase: { state: "rate_limited" } }, [
              {
                type: "PersistState",
                patch: {
                  run: { stoppedReason: "rate_limited", lastError: event.cause.message },
                },
              },
              {
                type: "WriteResumeInstructions",
                ctx: {
                  reason,
                  kind: event.kind,
                  resetAt: event.resetAt,
                  phaseId: event.phase,
                  worktreePath: event.worktreePath,
                  sessionId: event.sessionId,
                  rawMessage: event.cause.rawMessage,
                },
              },
              {
                type: "EmitTrace",
                name: "rate_limit.detected",
                status: "failed",
                boundary: "claude-code",
                details: { kind: event.kind, resetAt: event.resetAt },
              },
              {
                type: "EmitTrace",
                name: "resume.available",
                status: "info",
                boundary: "resume-instructions.md",
                details: { resumeCommand: `phax resume ${event.run}` },
              },
            ]);
          }
          return ignored(`rate limit while phase is ${ps}`);
        }
        case "rate_limited":
          return ignored("run is already rate_limited");
        case "interrupted":
          return ignored("run is interrupted; rate limit overridden");
        case "created":
          return unexpected("rate limit detected before run started");
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`rate limit on ${state.run} run`);
        case "awaiting_review":
          return stale("RateLimitDetected while the run awaits review");
        default:
          return assertNever(state);
      }

    // Takes RateLimitDetected's dispositions: the same pause, the same resume
    // path, told apart only by stoppedReason and lastError.
    case "NetworkFailureDetected":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          // A close reports a network failure with StopCloseRefused.
          if (ps === "awaiting_review") {
            return unexpected("network failure detected while a close of the stop runs");
          }
          if (ps === "running" || ps === "fixing") {
            return handled({ run: "rate_limited", phase: { state: "rate_limited" } }, [
              {
                type: "PersistState",
                patch: {
                  run: { stoppedReason: "network_failure", lastError: event.cause.message },
                },
              },
              {
                type: "WriteResumeInstructions",
                ctx: {
                  reason: "Network failure",
                  kind: "network_failure",
                  phaseId: event.phase,
                  worktreePath: event.worktreePath,
                  sessionId: event.sessionId,
                  rawMessage: event.cause.failure.message,
                },
              },
              {
                type: "EmitTrace",
                name: "network_failure.detected",
                status: "failed",
                boundary: event.cause.failure.provider,
                details: { provider: event.cause.failure.provider },
              },
              {
                type: "EmitTrace",
                name: "resume.available",
                status: "info",
                boundary: "resume-instructions.md",
                details: { resumeCommand: `phax resume ${event.run}` },
              },
            ]);
          }
          return ignored(`network failure while phase is ${ps}`);
        }
        case "rate_limited":
          return ignored("run is already rate_limited");
        case "interrupted":
          return ignored("run is interrupted; network failure overridden");
        case "created":
          return unexpected("network failure detected before run started");
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`network failure on ${state.run} run`);
        case "awaiting_review":
          return stale("NetworkFailureDetected while the run awaits review");
        default:
          return assertNever(state);
      }

    case "PhaseResetRequested": {
      const resetState: PhaxState = { run: "interrupted", phase: { state: "pending" } };
      const resetEffects: readonly PhaxCommand[] = [
        {
          type: "PersistState",
          patch: {
            run: { stoppedReason: "phase_reset" },
          },
        },
      ];
      const resetResult = handled(resetState, resetEffects);
      switch (state.run) {
        case "failed":
          return resetResult;
        case "running": {
          const ps = state.phase.state;
          if (ps === "gates_exhausted" || ps === "gates_failed" || ps === "handoff_failed") {
            return resetResult;
          }
          if (ps === "awaiting_review") {
            return rejected("a close of the stop is in progress");
          }
          return rejected(`cannot reset phase while it is ${ps}`);
        }
        case "interrupted": {
          const ps = state.phase.state;
          if (ps === "gates_exhausted") {
            return resetResult;
          }
          return rejected(`cannot reset phase while it is ${ps}`);
        }
        case "awaiting_review":
          return handled(resetState, [...resetEffects, { type: "DiscardReviewStop" }]);
        case "created":
        case "rate_limited":
        case "review_open":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`cannot reset phase while run is ${state.run}`);
        default:
          return assertNever(state);
      }
    }

    case "ReviewStopReached":
      if (event.reviewStop.cause !== event.cause) {
        return unexpected(
          `review stop reached with cause ${event.cause} carries a ${event.reviewStop.cause} review stop`,
        );
      }
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          // A declared stop is reached from the running phase; a held one after
          // the phase committed, or after a resumed handoff just passed
          // (no event moves a phase out of handoff_failed).
          const acceptedFrom =
            event.cause === "declared"
              ? ps === "running"
              : ps === "committed" || ps === "handoff_failed";
          if (acceptedFrom) {
            return handled(
              { run: "awaiting_review", phase: { state: "awaiting_review", cause: event.cause } },
              [
                {
                  type: "PersistState",
                  patch: {
                    run: { stoppedReason: "awaiting_review" },
                    phase: {
                      state: "awaiting_review",
                      stop: { cause: event.cause, status: "waiting" },
                    },
                  },
                },
                { type: "WriteReviewStop", reviewStop: event.reviewStop },
                {
                  type: "WriteResumeInstructions",
                  ctx: {
                    reason: "Awaiting review",
                    kind: "awaiting_review",
                    phaseId: event.phaseId,
                    worktreePath: event.worktreePath as string,
                  },
                },
                {
                  type: "EmitTrace",
                  name: "review.stop.reached",
                  status: "info",
                  boundary: "review-stop.json",
                  details: { phaseId: event.phaseId, cause: event.cause },
                },
              ],
            );
          }
          return unexpected(`${event.cause} review stop reached while phase is ${ps}`);
        }
        case "awaiting_review":
          return ignored("run already awaits review");
        case "rate_limited":
          return unexpected("review stop reached while run is rate_limited");
        case "interrupted":
          return stale("review stop reached on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`review stop reached while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`review stop reached on ${state.run} run`);
        default:
          return assertNever(state);
      }

    case "StopCloseRefused":
      switch (state.run) {
        case "running": {
          if (state.phase.state === "awaiting_review") {
            return stopReturned(state.phase, event.phaseId, event.lastClose);
          }
          return unexpected(`stop close refused while phase is ${state.phase.state}`);
        }
        case "awaiting_review":
          return stale("stop close refused while no close runs");
        case "rate_limited":
          return unexpected("stop close refused while run is rate_limited");
        case "interrupted":
          return stale("stop close refused on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`stop close refused while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`stop close refused on ${state.run} run`);
        default:
          return assertNever(state);
      }

    case "StopCommitted":
      switch (state.run) {
        case "running": {
          if (state.phase.state === "awaiting_review") {
            if (state.phase.cause === "held") {
              return unexpected("a held stop closes with HeldStopClosed");
            }
            return handled({ run: "running", phase: { state: "committed", hash: event.hash } }, [
              {
                type: "PersistState",
                patch: {
                  phase: {
                    state: "committed",
                    commitHash: event.hash,
                    stop:
                      event.closure.outcome === "corrected"
                        ? {
                            cause: "declared",
                            status: "closed",
                            outcome: "corrected",
                            oracleStep: event.closure.oracleStep,
                            closedBy: event.closure.closedBy,
                          }
                        : {
                            cause: "declared",
                            status: "closed",
                            outcome: "unchanged",
                            closedBy: event.closure.closedBy,
                          },
                  },
                },
              },
              { type: "RecordCommitMetadata", hash: event.hash },
              { type: "DiscardReviewStop" },
            ]);
          }
          return unexpected(`stop committed while phase is ${state.phase.state}`);
        }
        case "awaiting_review":
          return stale("stop committed while no close runs");
        case "rate_limited":
          return unexpected("stop committed while run is rate_limited");
        case "interrupted":
          return stale("stop committed on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`stop committed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`stop committed on ${state.run} run`);
        default:
          return assertNever(state);
      }

    case "HeldStopClosed":
      switch (state.run) {
        case "running": {
          if (state.phase.state === "awaiting_review") {
            if (state.phase.cause === "declared") {
              return unexpected("a declared stop closes with StopCommitted");
            }
            // `commitHash` stays the phase commit: no RecordCommitMetadata.
            return handled(
              { run: "running", phase: { state: "committed", hash: event.phaseCommit } },
              [
                {
                  type: "PersistState",
                  patch: {
                    phase: {
                      state: "committed",
                      stop:
                        event.closure.outcome === "corrected"
                          ? {
                              cause: "held",
                              status: "closed",
                              outcome: "corrected",
                              reviewCommit: event.closure.reviewCommit,
                              oracleStep: event.closure.oracleStep,
                              closedBy: event.closure.closedBy,
                            }
                          : {
                              cause: "held",
                              status: "closed",
                              outcome: "unchanged",
                              closedBy: event.closure.closedBy,
                            },
                    },
                  },
                },
                { type: "DiscardReviewStop" },
              ],
            );
          }
          return unexpected(`held stop closed while phase is ${state.phase.state}`);
        }
        case "awaiting_review":
          return stale("held stop closed while no close runs");
        case "rate_limited":
          return unexpected("held stop closed while run is rate_limited");
        case "interrupted":
          return stale("held stop closed on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`held stop closed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`held stop closed on ${state.run} run`);
        default:
          return assertNever(state);
      }

    case "HoldPointFailed":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "committed" || ps === "handoff_failed") {
            return handled(
              { run: "interrupted", phase: { state: "committed", hash: event.phaseCommit } },
              [
                {
                  type: "PersistState",
                  patch: {
                    run: { stoppedReason: "hold_point_failed", lastError: event.reason },
                    phase: { state: "committed" },
                  },
                },
                {
                  type: "WriteResumeInstructions",
                  ctx: {
                    reason: "Hold point failed",
                    kind: "hold_point_failed",
                    phaseId: event.phaseId,
                    worktreePath: event.worktreePath as string,
                    rawMessage: event.reason,
                  },
                },
                {
                  type: "EmitTrace",
                  name: "hold.point.failed",
                  status: "failed",
                  boundary: "hold-point",
                  details: { phaseId: event.phaseId, reason: event.reason },
                },
                {
                  type: "EmitTrace",
                  name: "resume.available",
                  status: "info",
                  boundary: "resume-instructions.md",
                  details: { resumeCommand: `phax resume ${event.run}` },
                },
              ],
            );
          }
          return unexpected(`hold point failed while phase is ${ps}`);
        }
        case "rate_limited":
          return stale("hold point failed on rate-limited run");
        case "interrupted":
          return stale("hold point failed on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`hold point failed while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`hold point failed on ${state.run} run`);
        case "awaiting_review":
          return stale("HoldPointFailed while the run awaits review");
        default:
          return assertNever(state);
      }

    case "StopRecordRefused":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          // After StopCommitted or HeldStopClosed, or on a closed stop's
          // re-entry: the phase is committed and its closed stop stays as it is.
          if (ps === "committed") {
            return handled(
              { run: "interrupted", phase: { state: "committed", hash: event.phaseCommit } },
              [
                {
                  type: "PersistState",
                  patch: {
                    run: { stoppedReason: "stop_record_refused", lastError: event.reason },
                  },
                },
                {
                  type: "WriteResumeInstructions",
                  ctx: {
                    reason: "Records destination refused",
                    kind: "stop_record_refused",
                    phaseId: event.phaseId,
                    worktreePath: event.worktreePath as string,
                    rawMessage: event.reason,
                  },
                },
                {
                  type: "EmitTrace",
                  name: "stop.record.refused",
                  status: "failed",
                  boundary: "records",
                  details: { phaseId: event.phaseId, cause: event.cause, reason: event.reason },
                },
                {
                  type: "EmitTrace",
                  name: "resume.available",
                  status: "info",
                  boundary: "resume-instructions.md",
                  details: { resumeCommand: `phax resume ${event.run}` },
                },
              ],
            );
          }
          return unexpected(`stop record refused while phase is ${ps}`);
        }
        case "rate_limited":
          return stale("stop record refused on rate-limited run");
        case "interrupted":
          return stale("stop record refused on interrupted run");
        case "created":
        case "review_open":
          return unexpected(`stop record refused while run is ${state.run}`);
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return stale(`stop record refused on ${state.run} run`);
        case "awaiting_review":
          return stale("StopRecordRefused while the run awaits review");
        default:
          return assertNever(state);
      }
  }
}

/**
 * A close of the stop that did not commit, refused or interrupted: the run
 * returns to awaiting_review, and review-stop.json comes back with `lastClose`.
 * Only a refusal records `lastError`; an interruption leaves run-status.json to
 * the interrupt handler's own write.
 */
function stopReturned(
  phase: { readonly state: "awaiting_review"; readonly cause: StopCause },
  phaseId: string | undefined,
  lastClose: LastClose,
): Disposition<PhaxState> {
  const closeError =
    lastClose.result === "interrupted"
      ? `Close of the stop interrupted (exit ${lastClose.exitCode})`
      : `Close of the stop refused: ${lastClose.result} (exit ${lastClose.exitCode})`;
  return handled({ run: "awaiting_review", phase }, [
    ...(lastClose.result === "interrupted"
      ? []
      : [
          {
            type: "PersistState" as const,
            patch: { run: { stoppedReason: "awaiting_review", lastError: closeError } },
          },
        ]),
    { type: "RestoreReviewStop", lastClose },
    {
      type: "WriteResumeInstructions",
      ctx: { reason: "Awaiting review", kind: "awaiting_review", phaseId, rawMessage: closeError },
    },
  ]);
}
