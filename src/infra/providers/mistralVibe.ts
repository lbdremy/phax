import { Effect, Either } from "effect";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentRunOptions, AgentRunResult } from "../../ports/backend.js";
import { FsError } from "../../ports/fs.js";
import {
  AgentInvocationError,
  AgentSessionIdMissingError,
  RateLimitError,
  UsageLimitError,
} from "../../domain/errors.js";
import { decodeClaudeSessionId } from "../../domain/branded.js";
import { classifyRateLimit } from "../../schemas/claudeOutput.js";
import {
  findVibeResultEvent,
  findVibeSessionId,
  hasVibeErroredResultEvent,
} from "../../schemas/vibeOutput.js";
import { persistSessionId } from "./sessionWriter.js";

type VibeProviderEntry = {
  readonly executable: string;
  readonly modelEnvVar?: string | undefined;
  readonly defaultAgent?: string | undefined;
};

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

export function buildVibeArgs(
  entry: VibeProviderEntry,
  prompt: string,
  cwd: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = ["-p", prompt];
  args.push("--agent", entry.defaultAgent ?? "auto-approve");
  args.push("--output", "streaming");
  args.push("--trust");
  args.push("--workdir", cwd);
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  return args;
}

function spawnVibe(
  entry: VibeProviderEntry,
  args: readonly string[],
  outputJsonlPath: string | undefined,
  cwd: string,
  modelAlias: string,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let stderrBuf = "";

    let writeStream: ReturnType<typeof createWriteStream> | undefined;
    if (outputJsonlPath) {
      mkdir(dirname(outputJsonlPath), { recursive: true }).catch(() => undefined);
      writeStream = createWriteStream(outputJsonlPath, { flags: "w" });
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(entry.modelEnvVar ? { [entry.modelEnvVar]: modelAlias } : {}),
    };

    const proc = spawn(entry.executable, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
      env,
    });

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
      writeStream?.end();
      resolve({ lines, exitCode: code ?? 1, stderr: stderrBuf });
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
    ? new UsageLimitError({ message: "Vibe stopped: usage limit reached.", ...fields })
    : new RateLimitError({ message: "Vibe stopped: rate limit hit.", ...fields });
}

export function runVibeAgent(
  prompt: string,
  options: AgentRunOptions,
  entry: VibeProviderEntry,
  resumeSessionId?: string,
): Effect.Effect<
  AgentRunResult,
  AgentInvocationError | AgentSessionIdMissingError | RateLimitError | UsageLimitError | FsError
> {
  const args = buildVibeArgs(entry, prompt, options.cwd, resumeSessionId);
  const argv = [entry.executable, ...args];

  return Effect.gen(function* () {
    const startedAtMs = Date.now();

    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnVibe(entry, args, options.outputJsonlPath, options.cwd, options.model),
      catch: (err): AgentInvocationError =>
        new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv,
        }),
    });

    if (exitCode !== 0 || hasVibeErroredResultEvent(lines)) {
      const classification = classifyRateLimit(stderr, lines);
      if (classification !== undefined) {
        return yield* Effect.fail(rateLimitErrorFor(classification));
      }
    }

    if (exitCode !== 0) {
      return yield* Effect.fail(
        new AgentInvocationError({
          message: `vibe exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv,
        }),
      );
    }

    const found = findVibeResultEvent(lines);
    if (!found) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: "No assistant message found in vibe streaming output",
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
    }

    const sessionIdString = yield* Effect.tryPromise({
      try: () => findVibeSessionId({ cwd: options.cwd, sinceMs: startedAtMs }),
      catch: (err): AgentSessionIdMissingError =>
        new AgentSessionIdMissingError({
          message: `Failed to read vibe session log: ${err instanceof Error ? err.message : String(err)}`,
          outputPath: options.outputJsonlPath ?? "",
        }),
    });

    if (sessionIdString === undefined) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: "No vibe session log meta.json found for the current run",
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
    }

    const sessionIdResult = decodeClaudeSessionId(sessionIdString);
    if (Either.isLeft(sessionIdResult)) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: `Invalid session_id in vibe session log: "${sessionIdString}"`,
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
