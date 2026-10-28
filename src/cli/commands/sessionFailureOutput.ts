import { basename, dirname } from "node:path";
import { AgentSessionFailedError, RateLimitError, UsageLimitError } from "../../domain/errors.js";
import { sessionFailureLine } from "../../domain/session/failureError.js";
import type { SessionFailure } from "../../domain/session/outcome.js";

/** What a command renders: a failed session's error, or a limit built from one. */
export type SessionFailureError = AgentSessionFailedError | RateLimitError | UsageLimitError;

export function isSessionFailureError(err: unknown): err is SessionFailureError {
  return (
    err instanceof AgentSessionFailedError ||
    err instanceof RateLimitError ||
    err instanceof UsageLimitError
  );
}

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function quoteWord(word: string): string {
  if (word !== "" && SAFE_WORD.test(word)) return word;
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** `phax` plus the words, each quoted only where a shell needs it. */
export function retryCommandLine(words: readonly string[]): string {
  return ["phax", ...words.map(quoteWord)].join(" ");
}

function pointerLine(agentErrorLog: string | null, transcript: string | null): string | null {
  const inLogFolder =
    agentErrorLog !== null && transcript !== null && dirname(agentErrorLog) === dirname(transcript);
  const names = [
    agentErrorLog,
    transcript === null ? null : inLogFolder ? basename(transcript) : transcript,
  ].filter((name): name is string => name !== null);
  return names.length === 0 ? null : `  See ${names.join(" and ")}`;
}

/**
 * The lines a command prints for a failed agent session: the failure line, the
 * session id when the provider reported one, the files to read and, for a
 * network failure given a retry command, the command to run again.
 */
export function renderSessionFailure(
  err: SessionFailureError,
  retry: string | null,
): readonly string[] {
  const failure: SessionFailure | null =
    err instanceof AgentSessionFailedError ? err.failure : null;
  const lines = [`✗ ${failure === null ? err.message : sessionFailureLine(failure)}`];
  if (failure?.sessionId != null) lines.push(`  session: ${failure.sessionId}`);
  const pointers = pointerLine(err.agentErrorLog ?? null, err.transcript ?? null);
  if (pointers !== null) lines.push(pointers);
  if (failure?.kind === "network" && retry !== null) {
    lines.push(`  Retry once the network is back: ${retry}`);
  }
  return lines;
}
