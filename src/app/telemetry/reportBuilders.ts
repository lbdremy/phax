import type { RunId } from "../../domain/branded.js";
import type { AgentInvocationError } from "../../domain/errors.js";
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

export function reportClaudeFailure(
  e: AgentInvocationError,
  ctx: ReportContext,
): SystemErrorReport {
  const stderrExcerpt = e.stderrExcerpt ?? e.stderr;
  return makeSystemErrorReport({
    type: "adapter.claude_failed",
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
