import type { RunId } from "../branded.js";

const MAX_STDERR_BYTES = 4 * 1024;
const TRUNCATION_SUFFIX = "…<truncated>";

export interface SystemErrorReport {
  readonly type: string;
  readonly runId: RunId;
  readonly operationId?: string;
  readonly stateBefore?: string;
  readonly event?: string;
  readonly adapter?: string;
  readonly operation?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly exitCode?: number;
  readonly stderrExcerpt?: string;
  readonly cause: unknown;
}

export interface SystemErrorReportInput {
  readonly type: string;
  readonly runId: RunId;
  readonly operationId?: string;
  readonly stateBefore?: string;
  readonly event?: string;
  readonly adapter?: string;
  readonly operation?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly exitCode?: number;
  readonly stderrExcerpt?: string;
  readonly cause: unknown;
}

const truncateStderr = (excerpt: string): string => {
  const encoded = Buffer.from(excerpt, "utf8");
  if (encoded.byteLength <= MAX_STDERR_BYTES) return excerpt;
  const truncated = encoded.subarray(0, MAX_STDERR_BYTES).toString("utf8");
  return truncated + TRUNCATION_SUFFIX;
};

export const makeSystemErrorReport = (input: SystemErrorReportInput): SystemErrorReport => {
  const base: SystemErrorReport = {
    type: input.type,
    runId: input.runId,
    cause: input.cause,
  };

  return {
    ...base,
    ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
    ...(input.stateBefore !== undefined ? { stateBefore: input.stateBefore } : {}),
    ...(input.event !== undefined ? { event: input.event } : {}),
    ...(input.adapter !== undefined ? { adapter: input.adapter } : {}),
    ...(input.operation !== undefined ? { operation: input.operation } : {}),
    ...(input.expected !== undefined ? { expected: input.expected } : {}),
    ...(input.actual !== undefined ? { actual: input.actual } : {}),
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.stderrExcerpt !== undefined
      ? { stderrExcerpt: truncateStderr(input.stderrExcerpt) }
      : {}),
  };
};
