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
import { findCodexResultEvent, hasCodexErroredResultEvent } from "../../schemas/codexOutput.js";
import { persistSessionId } from "./sessionWriter.js";

type CodexProviderEntry = {
  readonly executable: string;
  readonly families?: Record<string, { readonly model: string }> | undefined;
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

/** Map a ThinkingLevel to the codex --reasoning-effort flag value. */
function mapReasoningEffort(effort: string): string {
  switch (effort) {
    case "off":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    case "max":
      return "high";
    default:
      return "medium";
  }
}

export function buildCodexArgs(
  entry: CodexProviderEntry,
  model: string,
  effort: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = [
    "--model",
    model,
    "--approval-mode",
    "full-auto",
    "--reasoning-effort",
    mapReasoningEffort(effort),
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  return args;
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
    ? new UsageLimitError({ message: "Codex stopped: usage limit reached.", ...fields })
    : new RateLimitError({ message: "Codex stopped: rate limit hit.", ...fields });
}

export function runCodexAgent(
  prompt: string,
  options: AgentRunOptions,
  entry: CodexProviderEntry,
  resumeSessionId?: string,
): Effect.Effect<
  AgentRunResult,
  AgentInvocationError | AgentSessionIdMissingError | RateLimitError | UsageLimitError | FsError
> {
  const model = entry.families?.["openai-gpt"]?.model ?? options.model;
  const args = buildCodexArgs(entry, model, options.effort, resumeSessionId);
  const argv = [entry.executable, ...args];

  return Effect.gen(function* () {
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnCodex(entry, args, prompt, options.outputJsonlPath, options.cwd),
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
