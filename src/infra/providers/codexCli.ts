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
  AgentSessionIdMissingError,
  RateLimitError,
  SecurityEnforcementError,
  UsageLimitError,
} from "../../domain/errors.js";
import { decodeClaudeSessionId } from "../../domain/branded.js";
import {
  buildCodexSecurityFlags,
  codexModelId,
  mapReasoningEffort,
} from "../../domain/session/codexFlags.js";
import { classifyRateLimit } from "../../schemas/claudeOutput.js";
import { findCodexResultEvent, hasCodexErroredResultEvent } from "../../schemas/codexOutput.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { persistSessionId } from "./sessionWriter.js";
import { writeAgentErrorLog } from "./agentErrorLog.js";
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
  readonly exitCode: number;
  readonly stderr: string;
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

    proc.on("close", (code) => {
      if (stdoutBuf.trim()) lines.push(stdoutBuf);
      const result = { lines, exitCode: code ?? 1, stderr: stderrBuf };
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

function rateLimitErrorFor(classification: {
  kind: "rate_limit" | "usage_limit";
  rawMessage: string;
  resetAt?: string | undefined;
}): RateLimitError | UsageLimitError {
  const fields = { rawMessage: classification.rawMessage, resetAt: classification.resetAt };
  return classification.kind === "usage_limit"
    ? new UsageLimitError({ message: "Codex stopped: usage limit reached.", ...fields })
    : new RateLimitError({ message: "Codex stopped: rate limit hit.", ...fields });
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
  AgentInvocationError | RateLimitError | UsageLimitError | FsError
> {
  const args = buildCodexCompletionArgs(entry, options);
  const argv = [entry.executable, ...args];

  return Effect.gen(function* () {
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnCodex(entry, args, prompt, undefined, options.cwd),
      catch: (err): AgentInvocationError =>
        new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv,
        }),
    });

    if (exitCode !== 0 || hasCodexErroredResultEvent(lines)) {
      const classification = classifyRateLimit(stderr, lines);
      if (classification !== undefined) {
        return yield* Effect.fail(rateLimitErrorFor(classification));
      }
    }

    if (exitCode !== 0) {
      return yield* Effect.fail(
        new AgentInvocationError({
          message: `codex exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv,
        }),
      );
    }

    const found = findCodexResultEvent(lines);
    return { finalText: found?.finalText ?? "" };
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
  | AgentSessionIdMissingError
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
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
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

    if (exitCode !== 0 || hasCodexErroredResultEvent(lines)) {
      const classification = classifyRateLimit(stderr, lines);
      if (classification !== undefined) {
        return yield* Effect.fail(rateLimitErrorFor(classification));
      }
    }

    if (exitCode !== 0) {
      writeAgentErrorLog(options.phaseFolderPath, { argv, exitCode, stderr });
      return yield* Effect.fail(
        new AgentInvocationError({
          message: `codex exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv,
          phaseFolderPath: options.phaseFolderPath,
        }),
      );
    }

    const found = findCodexResultEvent(lines);
    if (!found) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: "No result event with session_id found in codex output",
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
    }

    const sessionIdResult = decodeClaudeSessionId(found.sessionId);
    if (Either.isLeft(sessionIdResult)) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: `Invalid session_id in codex output: "${found.sessionId}"`,
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
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
      finalText: found.finalText,
    };
  });
}
