import { Either } from "effect";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { decodeClaudeSessionId, type ClaudeSessionId } from "../../domain/branded.js";
import type {
  AgentSessionFailedError,
  RateLimitError,
  UsageLimitError,
} from "../../domain/errors.js";
import { vibeExportDirOf } from "../../domain/records/usage.js";
import {
  AGENT_ERROR_LOG,
  archivedLogName,
  archivedTranscriptName,
  nextFailureNumber,
  transcriptOfLog,
  withTranscriptLine,
} from "../../domain/session/failureArchive.js";
import { sessionFailureError } from "../../domain/session/failureError.js";
import type { SessionEnd, SessionFailure, SessionOutcome } from "../../domain/session/outcome.js";

export interface AgentErrorContext {
  readonly argv: readonly string[];
  readonly exitCode?: number | undefined;
  readonly stderr?: string | undefined;
  /** The failed session's outcome; absent or null for a phax refusal. */
  readonly failure?: SessionFailure | null | undefined;
  /** The session's transcript, named in the failure header. */
  readonly transcript?: string | null | undefined;
}

/** The path agent-error.log takes in a phase folder, or null without one. */
function agentErrorLogPath(phaseFolderPath: string | undefined): string | null {
  return phaseFolderPath ? join(phaseFolderPath, AGENT_ERROR_LOG) : null;
}

/**
 * Before a session starts in `phaseFolderPath`, archive the failure an
 * earlier session left there, so it neither reads as this session's nor
 * loses its transcript: `agent-error.log` becomes `agent-error.failed-NN.log`
 * and, when the new session is about to write the same transcript
 * (`nextTranscript`), that transcript (and a Vibe turn's export directory)
 * takes the matching `.failed-NN` name, which the archived log's
 * `transcript:` line then names. A transcript the new session does not
 * overwrite stays where it is. Never throws: archiving must not stop the
 * session.
 */
export function archivePreviousFailure(
  phaseFolderPath: string | undefined,
  nextTranscript: string | undefined,
): void {
  const logPath = agentErrorLogPath(phaseFolderPath);
  if (phaseFolderPath === undefined || logPath === null) return;
  try {
    if (!existsSync(logPath)) return;
    const n = nextFailureNumber(readdirSync(phaseFolderPath));
    let log = readFileSync(logPath, "utf8");
    const transcript = transcriptOfLog(log);
    if (
      transcript !== null &&
      nextTranscript !== undefined &&
      resolve(transcript) === resolve(nextTranscript) &&
      existsSync(transcript)
    ) {
      const archived = archivedTranscriptName(transcript, n);
      renameSync(transcript, archived);
      const exportDir = vibeExportDirOf(transcript);
      if (exportDir !== transcript && existsSync(exportDir)) {
        renameSync(exportDir, vibeExportDirOf(archived));
      }
      log = withTranscriptLine(log, archived);
    }
    writeFileSync(join(phaseFolderPath, archivedLogName(n)), log, "utf8");
    unlinkSync(logPath);
  } catch {
    // never throw — a failed archive must not stop the session
  }
}

/**
 * The header a failed session's log opens with: the failure kind, the
 * provider, its message on one line, the session id and the transcript.
 */
function failureHeader(failure: SessionFailure, transcript: string | null): string[] {
  return [
    `failure: ${failure.kind}`,
    `provider: ${failure.provider}`,
    `message: ${failure.message.replace(/\s*\r?\n\s*/g, " ").trim()}`,
    `session: ${failure.sessionId ?? "none"}`,
    `transcript: ${transcript ?? "none"}`,
    "",
  ];
}

/**
 * Write a human-readable agent-error.log into the phase folder when an agent
 * session fails, or phax refuses one. A failed session's log opens with its
 * failure header; a refusal's keeps the argv-first shape. Never throws — a
 * logging failure must not mask the underlying agent failure.
 */
export function writeAgentErrorLog(
  phaseFolderPath: string | undefined,
  ctx: AgentErrorContext,
): void {
  const filePath = agentErrorLogPath(phaseFolderPath);
  if (filePath === null) return;
  try {
    const content = [
      ...(ctx.failure ? failureHeader(ctx.failure, ctx.transcript ?? null) : []),
      ctx.argv.join(" "),
      `exit code: ${ctx.exitCode ?? "unknown"}`,
      "",
      ctx.stderr ?? "",
    ].join("\n");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  } catch {
    // never throw — logging failure must not mask the underlying agent failure
  }
}

/** A closed process's end, from Node's `close` arguments. */
export function sessionEndOf(code: number | null, signal: NodeJS.Signals | null): SessionEnd {
  return code === null && signal !== null
    ? { kind: "signalled", signal }
    : { kind: "exited", code: code ?? 1 };
}

/** A failed session as an adapter saw it: what it ran, how it ended, where it wrote. */
export interface FailedSessionContext {
  readonly argv: readonly string[];
  readonly end: SessionEnd;
  readonly stderr: string;
  readonly phaseFolderPath: string | undefined;
  readonly transcript: string | undefined;
}

/**
 * Writes the failed session's agent-error.log (when it has a phase folder) and
 * returns the error the session raises, naming that log and the transcript.
 */
export function failSession(
  failure: SessionFailure,
  ctx: FailedSessionContext,
): AgentSessionFailedError | RateLimitError | UsageLimitError {
  const transcript = ctx.transcript ?? null;
  writeAgentErrorLog(ctx.phaseFolderPath, {
    argv: ctx.argv,
    exitCode: ctx.end.kind === "exited" ? ctx.end.code : undefined,
    stderr: ctx.stderr,
    failure,
    transcript,
  });
  return sessionFailureError(failure, {
    agentErrorLog: agentErrorLogPath(ctx.phaseFolderPath),
    transcript,
  });
}

/**
 * The session id an agent turn's answer must carry, or the `provider-error`
 * failure it reads as without one (or with one phax cannot keep).
 */
export function answerSessionId(
  answer: Extract<SessionOutcome, { kind: "answer" }>,
): Either.Either<ClaudeSessionId, SessionFailure> {
  const failure = (message: string): SessionFailure => ({
    provider: answer.provider,
    kind: "provider-error",
    message,
    sessionId: null,
    resetAt: null,
  });
  if (answer.sessionId === null) {
    return Either.left(failure(`${answer.provider} reported no session id for the turn`));
  }
  return Either.mapLeft(decodeClaudeSessionId(answer.sessionId), () =>
    failure(`${answer.provider} reported an invalid session id: "${answer.sessionId}"`),
  );
}
