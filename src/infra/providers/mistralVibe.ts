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
  SecurityEnforcementError,
  UsageLimitError,
} from "../../domain/errors.js";
import { decodeClaudeSessionId } from "../../domain/branded.js";
import type { SecurityPolicy } from "../../domain/security/types.js";
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

// Centralized secure-mode Vibe flag set. Vibe's provider-native controls are
// weaker than Claude/Codex (see PROVIDER_SECURITY_CAPABILITIES): filesystem
// jail is "partial" and network allowlisting is "unsupported". Strict callers
// skip Vibe via the routing fallback (phase-03); when Vibe is invoked in
// secure mode here PHAX hardens what it can and the evaluation surfaces the
// partial-secured marking. Today's surface:
//   --agent <entry.defaultAgent ?? "auto-approve">
//       The approval policy. `entry.defaultAgent` is the injection point for a
//       PHAX-specific restricted agent (configurable per project); the default
//       remains auto-approve for non-interactive runs.
//   --workdir <cwd>
//       Scopes the agent's working directory to the worktree (allowWrite[0]).
//   --add-dir <path>
//       Additional readable/writable directories beyond cwd. Emitted only for
//       ~/.phax and any project-configured extras.
//   (no --trust)
//       Unsafe mode emits --trust to grant blanket directory trust; secure
//       mode drops it so only the explicit workdir + add-dir set is allowed.
//
// Not yet expressible via Vibe CLI flags (tracked in runbook 04b):
//   - Per-command allowlist: Vibe provides no command-level restriction flag.
//     The frozen agentCommands set (config ∪ gates) is recorded in security.json
//     with enforcement: "none"; the approval policy is the effective constraint.
//   - Tool-level restriction beyond the agent's approval policy.
//   - Network allowlist: not supported by vibe — the partial-secured marking
//     and VIBE_PARTIAL_SECURED_MESSAGE surface this; the resolved domains
//     stay on SecurityPolicy and land in security.json (phase-09).
//   - MCP scoping: vibe configures MCP via its config; PHAX records the
//     resolved mcp policy on SecurityPolicy but does not emit a flag here
//     until 04b confirms an override surface.
function buildVibeSecurityFlags(security: SecurityPolicy, cwd: string): string[] {
  if (security.mode === "unsafe") {
    return ["--trust", "--workdir", cwd];
  }
  // secure / isolated (CLI gates isolated before reaching here; treat as
  // secure for type totality).
  if (security.filesystem.allowWrite.length === 0) {
    throw new SecurityEnforcementError({
      message:
        "Mistral Vibe secure mode requires at least one writable path in the security policy; refusing to run with blanket --trust.",
      provider: "mistral-vibe",
      mode: security.mode,
    });
  }
  const addDirs = security.filesystem.allowWrite
    .filter((p) => p !== cwd)
    .flatMap((p) => ["--add-dir", p]);
  return ["--workdir", cwd, ...addDirs];
}

export function buildVibeArgs(
  entry: VibeProviderEntry,
  prompt: string,
  options: AgentRunOptions,
  resumeSessionId?: string,
): string[] {
  const securityFlags = buildVibeSecurityFlags(options.security, options.cwd);
  const args: string[] = [
    "-p",
    prompt,
    "--agent",
    entry.defaultAgent ?? "auto-approve",
    "--output",
    "streaming",
    ...securityFlags,
  ];
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
  | AgentInvocationError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError
> {
  let args: string[];
  try {
    args = buildVibeArgs(entry, prompt, options, resumeSessionId);
  } catch (err) {
    if (err instanceof SecurityEnforcementError) {
      return Effect.fail(err);
    }
    throw err;
  }
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
