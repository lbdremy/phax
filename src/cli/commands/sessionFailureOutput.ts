import { basename, dirname } from "node:path";
import {
  AgentSessionFailedError,
  FailureWithFollowUpsError,
  HandoffPausedError,
  RateLimitError,
  UsageLimitError,
} from "../../domain/errors.js";
import { sessionFailureLine } from "../../domain/session/failureError.js";
import type { SessionFailure } from "../../domain/session/outcome.js";
import { buildWhatsNext, renderWhatsNext } from "../../domain/whatsNext.js";

/** What a command renders: a failed session's error, or a limit built from one. */
export type SessionFailureError = AgentSessionFailedError | RateLimitError | UsageLimitError;

export function isSessionFailureError(err: unknown): err is SessionFailureError {
  return (
    err instanceof AgentSessionFailedError ||
    err instanceof RateLimitError ||
    err instanceof UsageLimitError
  );
}

/**
 * A failure split into its cause and the follow-up warnings that ride on it:
 * a command prints the cause's lines first, then each follow-up.
 */
export function splitFollowUps(err: unknown): {
  readonly cause: unknown;
  readonly followUps: readonly string[];
} {
  return err instanceof FailureWithFollowUpsError
    ? { cause: err.cause, followUps: err.followUps }
    : { cause: err, followUps: [] };
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

/**
 * The failure of a run that paused on a lost network, or null for any other
 * error: only a pause names its phase, so a network failure raised elsewhere
 * (a stop's close, plan extraction) keeps the retry of the command that ran.
 */
export function pausedNetworkFailure(err: unknown): AgentSessionFailedError | null {
  return err instanceof AgentSessionFailedError &&
    err.failure.kind === "network" &&
    err.phaseId !== undefined
    ? err
    : null;
}

/** The failed session of a paused handoff turn, or null for a handoff that came back incomplete. */
export function pausedHandoffFailure(err: unknown): AgentSessionFailedError | null {
  return err instanceof HandoffPausedError && err.cause instanceof AgentSessionFailedError
    ? err.cause
    : null;
}

/**
 * What a run that paused on a network failure prints: the failure, the run's
 * pause with the one command to run once the network is back, and where the
 * resume instructions are.
 */
export function renderNetworkPause(
  err: AgentSessionFailedError,
  shortName: string,
  resumeInstructionsPath: string,
): readonly string[] {
  const next = buildWhatsNext({ kind: "network", shortName, phaseId: err.phaseId }, new Date());
  return [
    ...renderSessionFailure(err, null),
    renderWhatsNext(next),
    `See ${resumeInstructionsPath} for details.`,
  ];
}

/**
 * What a run whose handoff turn failed prints: the failure, then the resume
 * that re-runs only the handoff (for a network failure, the retry line).
 */
export function renderHandoffTurnPause(
  err: AgentSessionFailedError,
  shortName: string,
): readonly string[] {
  const resume = retryCommandLine(["resume", shortName]);
  const lines = renderSessionFailure(err, resume);
  return err.failure.kind === "network"
    ? lines
    : [...lines, `  Resume to re-run only the handoff: ${resume}`];
}
