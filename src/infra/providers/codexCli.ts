import { Effect, Either } from "effect";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentRunOptions,
  AgentRunResult,
  CompletionOptions,
  CompletionResult,
  TranscriptRead,
  TranscriptRequest,
} from "../../ports/backend.js";
import { FsError } from "../../ports/fs.js";
import {
  AgentInvocationError,
  type AgentSessionFailedError,
  type RateLimitError,
  SecurityEnforcementError,
  type UsageLimitError,
} from "../../domain/errors.js";
import {
  buildCodexSecurityFlags,
  codexModelId,
  mapReasoningEffort,
} from "../../domain/session/codexFlags.js";
import { sessionFailureError } from "../../domain/session/failureError.js";
import { readCodexOutcome, type SessionEnd } from "../../domain/session/outcome.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { persistSessionId } from "./sessionWriter.js";
import { answerSessionId, failSession, sessionEndOf, writeAgentErrorLog } from "./agentErrorLog.js";
import { captureFromStore, listStoreNames, notFound, readStoreFile } from "./transcriptStore.js";

type CodexProviderEntry = ProviderConfig["providers"][string];

function wrapFsError(err: unknown): FsError {
  return new FsError({
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}

interface SpawnResult {
  readonly lines: string[];
  readonly stderr: string;
  /** How the process ended: its exit code, or the signal that stopped it. */
  readonly end: SessionEnd;
}

// A read-only turn (phax's own turns at a stop): codex's read-only sandbox and
// no approvals, whatever the phase's policy, unsafe included. It grants no
// writable root and no network override: `sandbox_workspace_write.*` only
// applies under `workspace-write`. `codex exec resume` takes the same keys.
const CODEX_READ_ONLY_FLAGS = [
  "-c",
  `sandbox_mode="read-only"`,
  "-c",
  `approval_policy="never"`,
] as const;

export function buildCodexArgs(
  entry: CodexProviderEntry,
  options: AgentRunOptions,
  resumeSessionId?: string,
): string[] {
  const model = codexModelId(entry, options.model);
  const securityFlags =
    options.readOnly === true
      ? [...CODEX_READ_ONLY_FLAGS]
      : buildCodexSecurityFlags(options.security);
  const commonFlags: string[] = [
    "--json",
    "--skip-git-repo-check",
    ...securityFlags,
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${mapReasoningEffort(options.effort)}"`,
  ];
  if (resumeSessionId) {
    return ["exec", "resume", resumeSessionId, ...commonFlags];
  }
  return ["exec", "-C", options.cwd, ...commonFlags];
}

function spawnCodex(
  entry: CodexProviderEntry,
  args: readonly string[],
  prompt: string,
  outputJsonlPath: string | undefined,
  cwd: string | undefined,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let stderrBuf = "";

    let writeStream: ReturnType<typeof createWriteStream> | undefined;
    if (outputJsonlPath) {
      mkdir(dirname(outputJsonlPath), { recursive: true }).catch(() => undefined);
      writeStream = createWriteStream(outputJsonlPath, { flags: "w" });
    }

    const proc = spawn(entry.executable, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(cwd !== undefined ? { cwd } : {}),
    });

    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();

    let stdoutBuf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      writeStream?.write(text);
      stdoutBuf += text;
      const parts = stdoutBuf.split("\n");
      stdoutBuf = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) lines.push(line);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });

    proc.on("close", (code, signal) => {
      if (stdoutBuf.trim()) lines.push(stdoutBuf);
      const result = { lines, stderr: stderrBuf, end: sessionEndOf(code, signal) };
      // Resolve once the stream is flushed: the cost ledger reads it next.
      if (writeStream === undefined) resolve(result);
      else writeStream.end(() => resolve(result));
    });

    proc.on("error", (err) => {
      writeStream?.end();
      reject(err);
    });
  });
}

export function buildCodexCompletionArgs(
  entry: CodexProviderEntry,
  options: CompletionOptions,
): string[] {
  const model = codexModelId(entry, options.model);
  // `sandbox_mode="read-only"` is the network seal: it grants no write sandbox
  // and denies subprocess network outright. The `sandbox_workspace_write.*`
  // config table (including `network_access`) only takes effect in
  // `workspace-write` mode, so we do NOT emit a `network_access=false` override
  // here — it would be a no-op under read-only and misleadingly imply a write
  // sandbox is in play.
  return [
    "exec",
    "-C",
    options.cwd,
    "--json",
    "--skip-git-repo-check",
    "-c",
    `sandbox_mode="read-only"`,
    "-c",
    `approval_policy="never"`,
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${mapReasoningEffort(options.effort)}"`,
  ];
}

export function runCodexCompletion(
  prompt: string,
  options: CompletionOptions,
  entry: CodexProviderEntry,
): Effect.Effect<
  CompletionResult,
  AgentInvocationError | AgentSessionFailedError | RateLimitError | UsageLimitError | FsError
> {
  const args = buildCodexCompletionArgs(entry, options);
  const argv = [entry.executable, ...args];

  return Effect.gen(function* () {
    const { lines, stderr, end } = yield* Effect.tryPromise({
      try: () => spawnCodex(entry, args, prompt, undefined, options.cwd),
      catch: (err): AgentInvocationError =>
        new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv,
        }),
    });

    const outcome = readCodexOutcome({ lines, stderr, end });
    if (outcome.kind === "failure") {
      return yield* Effect.fail(
        sessionFailureError(outcome.failure, { agentErrorLog: null, transcript: null }),
      );
    }
    return { finalText: outcome.text };
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The `YYYY/MM/DD` folders codex may have filed a session started at
 * `startedAt` under: its UTC and local dates, and the day after each, since a
 * session can outlive midnight. Empty for an unparseable instant.
 */
export function codexSessionDayFolders(startedAt: string): readonly string[] {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return [];
  const folders = new Set<string>();
  for (const instant of [new Date(start), new Date(start + DAY_MS)]) {
    folders.add(
      `${instant.getUTCFullYear()}/${pad(instant.getUTCMonth() + 1)}/${pad(instant.getUTCDate())}`,
    );
    folders.add(
      `${instant.getFullYear()}/${pad(instant.getMonth() + 1)}/${pad(instant.getDate())}`,
    );
  }
  return [...folders];
}

/**
 * A codex session's transcript, `<codex root>/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`.
 * The day folders of its start come first (see {@link codexSessionDayFolders});
 * failing them, every year, month and day folder is listed by name.
 */
export function captureCodexTranscript(
  codexRoot: string | null,
  request: TranscriptRequest,
): Effect.Effect<TranscriptRead, never> {
  return captureFromStore(codexRoot, request.sessionId, async (root) => {
    const sessions = join(root, "sessions");
    const suffix = `-${request.sessionId}.jsonl`;
    const inDay = async (day: string): Promise<TranscriptRead | null> => {
      const names = await listStoreNames(join(sessions, day));
      if (names === "absent") return null;
      const name = names.find((n) => n.startsWith("rollout-") && n.endsWith(suffix));
      return name === undefined ? null : readStoreFile(join(sessions, day, name));
    };
    for (const day of codexSessionDayFolders(request.startedAt)) {
      const read = await inDay(day);
      if (read !== null) return read;
    }
    const years = await listStoreNames(sessions);
    if (years === "absent") return notFound(`no codex sessions folder at ${sessions}`);
    for (const year of years) {
      const months = await listStoreNames(join(sessions, year));
      if (months === "absent") continue;
      for (const month of months) {
        const days = await listStoreNames(join(sessions, year, month));
        if (days === "absent") continue;
        for (const day of days) {
          const read = await inDay(`${year}/${month}/${day}`);
          if (read !== null) return read;
        }
      }
    }
    return notFound(`no rollout for session ${request.sessionId} under ${sessions}`);
  });
}

export function runCodexAgent(
  prompt: string,
  options: AgentRunOptions,
  entry: CodexProviderEntry,
  resumeSessionId?: string,
): Effect.Effect<
  AgentRunResult,
  | AgentInvocationError
  | AgentSessionFailedError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError
> {
  let args: string[];
  try {
    args = buildCodexArgs(entry, options, resumeSessionId);
  } catch (err) {
    if (err instanceof SecurityEnforcementError) {
      return Effect.fail(err);
    }
    throw err;
  }
  const argv = [entry.executable, ...args];

  return Effect.gen(function* () {
    const { lines, stderr, end } = yield* Effect.tryPromise({
      try: () => spawnCodex(entry, args, prompt, options.outputJsonlPath, options.cwd),
      catch: (err): AgentInvocationError => {
        writeAgentErrorLog(options.phaseFolderPath, {
          argv,
          stderr: err instanceof Error ? err.message : String(err),
        });
        return new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv,
          phaseFolderPath: options.phaseFolderPath,
        });
      },
    });

    const failed = {
      argv,
      end,
      stderr,
      phaseFolderPath: options.phaseFolderPath,
      transcript: options.outputJsonlPath,
    };
    const outcome = readCodexOutcome({ lines, stderr, end });
    if (outcome.kind === "failure") {
      return yield* Effect.fail(failSession(outcome.failure, failed));
    }
    const sessionIdResult = answerSessionId(outcome);
    if (Either.isLeft(sessionIdResult)) {
      return yield* Effect.fail(failSession(sessionIdResult.left, failed));
    }

    const capturedSessionId = sessionIdResult.right;

    if (options.phaseFolderPath !== undefined) {
      yield* Effect.tryPromise({
        try: () => persistSessionId(capturedSessionId, options.phaseFolderPath as string),
        catch: wrapFsError,
      });
    }

    return {
      sessionId: capturedSessionId,
      outputPath: options.outputJsonlPath ?? "",
      finalText: outcome.text,
    };
  });
}
