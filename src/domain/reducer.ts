import type { Disposition } from "./disposition.js";
import type { PhaxCommand } from "./effects.js";
import type { PhaxEvent } from "./events.js";
import type { PhaxState } from "./state.js";

const handled = (
  nextState: PhaxState,
  effects: readonly PhaxCommand[] = [],
): Disposition<PhaxState> => ({ kind: "Handled", nextState, effects });

const ignored = (reason: string): Disposition<PhaxState> => ({ kind: "Ignored", reason });
const stale = (reason: string): Disposition<PhaxState> => ({ kind: "Stale", reason });
const rejected = (reason: string): Disposition<PhaxState> => ({ kind: "Rejected", reason });
const unexpected = (reason: string): Disposition<PhaxState> => ({ kind: "Unexpected", reason });

function assertNever(x: never): never {
  throw new Error(`Unhandled discriminator: ${JSON.stringify(x)}`);
}

function describeCause(cause: unknown): string {
  if (cause == null) return "unknown";
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Pure reducer: maps (state, event) to an explicit disposition.
 *
 * The outer switch covers every event type; the inner switch covers every
 * run state. Phase-substate refinement happens inside the run-state arms.
 * Every branch returns explicitly — code after each inner switch is
 * unreachable and TypeScript narrows the residual state to `never`.
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
      }
      return assertNever(state);

    case "RunResumeRequested":
      switch (state.run) {
        case "rate_limited":
          return handled({ run: "running", phase: { state: "running" } });
        case "interrupted":
          return handled({ run: "running", phase: state.phase });
        case "running":
          return ignored("run is already running");
        case "created":
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`cannot resume run from ${state.run}`);
      }
      return assertNever(state);

    case "RunInterruptRequested":
      switch (state.run) {
        case "running":
        case "rate_limited":
          return handled({ run: "interrupted", phase: state.phase });
        case "interrupted":
          return ignored("run is already interrupted");
        case "created":
        case "review_open":
        case "failed":
        case "completed":
        case "stopped":
        case "archived":
          return rejected(`cannot interrupt run from ${state.run}`);
      }
      return assertNever(state);

    case "RunArchiveRequested":
      switch (state.run) {
        case "review_open":
        case "completed":
          // Diff patch persists state="archived" to runs/<short>/run-status.json
          // first; then MoveRunToArchive renames the directory. The registry
          // index entry (which carries archivePath) is updated by the caller.
          return handled({ run: "archived" }, [
            { type: "MoveRunToArchive", from: event.from, to: event.to },
          ]);
        case "archived":
          return rejected("run is already archived");
        case "created":
        case "running":
        case "rate_limited":
        case "interrupted":
        case "failed":
        case "stopped":
          return rejected(`cannot archive run from ${state.run}`);
      }
      return assertNever(state);

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
      }
      return assertNever(state);

    case "FinalReviewOpened":
      switch (state.run) {
        case "running":
        case "interrupted": {
          const ps = state.phase.state;
          if (ps === "committed" || ps === "cleaned_up" || ps === "skipped") {
            return handled({ run: "review_open", phase: { state: "review_open" } }, [
              { type: "OpenRunReview", info: event.info },
              { type: "WriteFinalReport", info: event.info },
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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

    case "FixAttemptsExhausted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "gates_failed" || ps === "fixing") {
            return handled({
              run: "running",
              phase: { state: "failed", cause: "fix attempts exhausted" },
            });
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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

    case "CleanupStarted":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
          if (ps === "committed") {
            return handled({ run: "running", phase: { state: "cleaning_up" } });
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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

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
      }
      return assertNever(state);

    case "RateLimitDetected":
      switch (state.run) {
        case "running": {
          const ps = state.phase.state;
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
      }
      return assertNever(state);
  }
}
