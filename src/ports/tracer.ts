import { Context, Effect } from "effect";

/**
 * Structured event names emitted across the system boundaries (spec §8).
 * The union is the single source of truth for both verbose and trace output.
 */
export type TraceEventName =
  | "config.discovered"
  | "config.validated"
  | "contract.validated"
  | "contract.invalid"
  | "git.worktree.created"
  | "git.commit.created"
  | "agent.invocation.started"
  | "agent.invocation.completed"
  | "agent.session.captured"
  | "gate.started"
  | "gate.completed"
  | "gate.failed"
  | "fix.started"
  | "fix.completed"
  | "handoff.requested"
  | "handoff.validated"
  | "rate_limit.detected"
  | "phase.no_changes.detected"
  | "resume.available"
  | "archive.completed"
  | "event.handled"
  | "event.ignored"
  | "event.stale"
  | "event.rejected"
  | "event.unexpected";

export type TraceStatus = "ok" | "failed" | "info";

/** A single structured trace event (spec §8 shape). */
export interface TraceEvent {
  readonly timestamp: string;
  readonly run: string;
  readonly phase?: string | undefined;
  readonly event: TraceEventName;
  readonly boundary?: string | undefined;
  readonly status: TraceStatus;
  readonly details?: Record<string, unknown> | undefined;
}

export interface TracerOps {
  /**
   * Emit a trace event. The error channel is `never` by design — tracing must
   * never fail or interrupt a run, so implementations swallow their own errors.
   */
  event(e: TraceEvent): Effect.Effect<void, never, never>;
}

export class Tracer extends Context.Tag("phax/Tracer")<Tracer, TracerOps>() {}
