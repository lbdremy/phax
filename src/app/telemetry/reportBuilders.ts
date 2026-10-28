import type { RunId } from "../../domain/branded.js";
import {
  AgentInvocationError,
  AgentSessionFailedError,
  RateLimitError,
  UsageLimitError,
} from "../../domain/errors.js";
import type { FailureKind } from "../../domain/session/outcome.js";
import { makeSystemErrorReport, type SystemErrorReport } from "../../domain/telemetry/errors.js";
import type { GitError } from "../../ports/git.js";
import type { ShellError } from "../../ports/shell.js";

export interface ReportContext {
  readonly runId: RunId;
  readonly operationId?: string;
  readonly adapter: string;
  readonly operation: string;
  readonly expected?: string;
}

export function reportShellFailure(e: ShellError, ctx: ReportContext): SystemErrorReport {
  return makeSystemErrorReport({
    type: "adapter.shell_failed",
    runId: ctx.runId,
    ...(ctx.operationId !== undefined ? { operationId: ctx.operationId } : {}),
    adapter: ctx.adapter,
    operation: ctx.operation,
    ...(ctx.expected !== undefined ? { expected: ctx.expected } : {}),
    ...(e.exitCode !== undefined ? { exitCode: e.exitCode } : {}),
    ...(e.stderrExcerpt !== undefined ? { stderrExcerpt: e.stderrExcerpt } : {}),
    cause: e,
  });
}

export function reportGitFailure(e: GitError, ctx: ReportContext): SystemErrorReport {
  const stderrExcerpt = e.stderrExcerpt ?? e.stderr;
  return makeSystemErrorReport({
    type: "adapter.git_failed",
    runId: ctx.runId,
    ...(ctx.operationId !== undefined ? { operationId: ctx.operationId } : {}),
    adapter: ctx.adapter,
    operation: ctx.operation,
    ...(ctx.expected !== undefined ? { expected: ctx.expected } : {}),
    ...(e.exitCode !== undefined ? { exitCode: e.exitCode } : {}),
    ...(stderrExcerpt !== undefined ? { stderrExcerpt } : {}),
    cause: e,
  });
}

/** A cost ledger entry phax could not record: the invocation's own outcome stands. */
export function reportCostLedgerFailure(cause: unknown, ctx: ReportContext): SystemErrorReport {
  return makeSystemErrorReport({
    type: "cost_ledger.record_failed",
    runId: ctx.runId,
    ...(ctx.operationId !== undefined ? { operationId: ctx.operationId } : {}),
    adapter: ctx.adapter,
    operation: ctx.operation,
    ...(ctx.expected !== undefined ? { expected: ctx.expected } : {}),
    cause,
  });
}

/** A failed agent session (or a limit), or an invocation phax could not complete. */
export type AgentFailure =
  | AgentInvocationError
  | AgentSessionFailedError
  | RateLimitError
  | UsageLimitError;

/** The failure kind a failed session or a limit reads as. */
function failureKindOf(e: AgentSessionFailedError | RateLimitError | UsageLimitError): FailureKind {
  if (e instanceof AgentSessionFailedError) return e.failure.kind;
  return e instanceof UsageLimitError ? "usage-limit" : "rate-limit";
}

/** Whether an error is a failed agent session or a limit, the errors telemetry reports a kind for. */
export function isAgentFailure(e: unknown): e is AgentFailure {
  return (
    e instanceof AgentInvocationError ||
    e instanceof AgentSessionFailedError ||
    e instanceof RateLimitError ||
    e instanceof UsageLimitError
  );
}

/**
 * An agent failure's report. A failed session (or a limit) reports its
 * failure kind as `actual`; an invocation error its exit code and stderr.
 */
export function reportAgentFailure(e: AgentFailure, ctx: ReportContext): SystemErrorReport {
  if (!(e instanceof AgentInvocationError)) {
    return makeSystemErrorReport({
      type: "adapter.agent_failed",
      runId: ctx.runId,
      ...(ctx.operationId !== undefined ? { operationId: ctx.operationId } : {}),
      adapter: ctx.adapter,
      operation: ctx.operation,
      ...(ctx.expected !== undefined ? { expected: ctx.expected } : {}),
      actual: failureKindOf(e),
      cause: e,
    });
  }
  const stderrExcerpt = e.stderrExcerpt ?? e.stderr;
  return makeSystemErrorReport({
    type: "adapter.agent_failed",
    runId: ctx.runId,
    ...(ctx.operationId !== undefined ? { operationId: ctx.operationId } : {}),
    adapter: ctx.adapter,
    operation: ctx.operation,
    ...(ctx.expected !== undefined ? { expected: ctx.expected } : {}),
    ...(e.exitCode !== undefined ? { exitCode: e.exitCode } : {}),
    ...(stderrExcerpt !== undefined ? { stderrExcerpt } : {}),
    cause: e,
  });
}
