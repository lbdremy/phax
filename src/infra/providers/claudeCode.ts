import { Effect, Either } from "effect";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentRunOptions, AgentRunResult } from "../../ports/backend.js";
import { FsError } from "../../ports/fs.js";
import {
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  RateLimitError,
  UsageLimitError,
} from "../../domain/errors.js";
import { decodeClaudeSessionId } from "../../domain/branded.js";
import type { ClaudeSessionId } from "../../domain/branded.js";
import {
  classifyRateLimit,
  findResultEvent,
  hasErroredResultEvent,
  type RateLimitClassification,
} from "../../schemas/claudeOutput.js";
import { decodePhaseStatus, encodePhaseStatus } from "../../schemas/status.js";

function wrapFsError(err: unknown): FsError {
  return new FsError({
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const rand = randomBytes(6).toString("hex");
  const tmpPath = `${filePath}.tmp.${rand}`;
  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, filePath);
}

interface SpawnResult {
  readonly lines: string[];
  readonly exitCode: number;
  readonly stderr: string;
}

function spawnClaude(
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

    const proc = spawn("claude", [...args], {
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

async function persistSessionId(
  sessionId: ClaudeSessionId,
  phaseFolderPath: string,
): Promise<void> {
  const sessionIdPath = join(phaseFolderPath, "claude-session-id.txt");
  const statusPath = join(phaseFolderPath, "status.json");

  await writeAtomic(sessionIdPath, sessionId);

  try {
    const text = await readFile(statusPath, "utf8");
    const decoded = decodePhaseStatus(JSON.parse(text) as unknown);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        claudeSessionId: sessionId,
        updatedAt: new Date().toISOString(),
      };
      await writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  } catch {
    // Status file absent or malformed — session-id.txt already written, continue.
  }
}

function buildArgs(options: AgentRunOptions, resumeSessionId?: string): string[] {
  // `claude` requires `--verbose` whenever `--print` is paired with
  // `--output-format=stream-json`; without it the CLI exits with code 1.
  // `--permission-mode bypassPermissions` is required for non-interactive runs:
  // phax owns the worktree it spawns claude in, so prompting for Write/Edit
  // approval would deadlock the headless session.
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--model",
    options.model,
    "--effort",
    options.effort,
  ];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  return args;
}

/** Build a typed rate-limit / usage-limit error from a classification. */
function rateLimitErrorFor(
  classification: RateLimitClassification,
): RateLimitError | UsageLimitError {
  const fields = {
    rawMessage: classification.rawMessage,
    resetAt: classification.resetAt,
  };
  return classification.kind === "usage_limit"
    ? new UsageLimitError({
        message: "Claude Code stopped: usage limit reached.",
        ...fields,
      })
    : new RateLimitError({
        message: "Claude Code stopped: rate limit hit.",
        ...fields,
      });
}

export function runClaudeAgent(
  prompt: string,
  options: AgentRunOptions,
  resumeSessionId?: string,
): Effect.Effect<
  AgentRunResult,
  ClaudeInvocationError | ClaudeSessionIdMissingError | RateLimitError | UsageLimitError | FsError
> {
  const args = buildArgs(options, resumeSessionId);
  return Effect.gen(function* () {
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnClaude(args, prompt, options.outputJsonlPath, options.cwd),
      catch: (err): ClaudeInvocationError =>
        new ClaudeInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv: ["claude", ...args],
        }),
    });

    // Reclassify a failure as a rate/usage limit when the output carries one of
    // the known signatures — on a non-zero exit, or on an errored result event.
    if (exitCode !== 0 || hasErroredResultEvent(lines)) {
      const classification = classifyRateLimit(stderr, lines);
      if (classification !== undefined) {
        return yield* Effect.fail(rateLimitErrorFor(classification));
      }
    }

    if (exitCode !== 0) {
      return yield* Effect.fail(
        new ClaudeInvocationError({
          message: `claude exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv: ["claude", ...args],
        }),
      );
    }

    const found = findResultEvent(lines);
    if (!found) {
      return yield* Effect.fail(
        new ClaudeSessionIdMissingError({
          message: "No result event with session_id found in claude output",
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
    }

    const sessionIdResult = decodeClaudeSessionId(found.sessionId);
    if (Either.isLeft(sessionIdResult)) {
      return yield* Effect.fail(
        new ClaudeSessionIdMissingError({
          message: `Invalid session_id in claude output: "${found.sessionId}"`,
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
