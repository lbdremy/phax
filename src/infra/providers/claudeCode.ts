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
import {
  classifyRateLimit,
  findResultEvent,
  hasErroredResultEvent,
  type RateLimitClassification,
} from "../../schemas/claudeOutput.js";
import { persistSessionId } from "./sessionWriter.js";

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

// Centralized secure-mode Claude flag set. Runbook 04b will validate which of
// these the installed `claude` CLI actually enforces; corrections feed back
// here. Today's surface:
//   --permission-mode default  (drops bypassPermissions; PHAX no longer hands
//                              the agent blanket host access)
//   --add-dir <path>           (one per writable path outside cwd; cwd is
//                              implicit, so worktree pass-through happens via
//                              the spawn cwd)
//   --disallowed-tools Bash    (no unsandboxed shell — matches spec §8 "Bash
//                              commands should run sandboxed")
//   --strict-mcp-config        (no MCP servers loaded unless explicitly given
//                              via --mcp-config; satisfies mcp.mode "disabled"
//                              and constrains "allowlist")
//   --mcp-config <path>...     (one per file when mcp.mode === "allowlist")
//
// Not yet expressible via Claude CLI flags (tracked in 04b):
//   - network.allowDomains: there is no native --allowed-domains flag. The
//     resolved domain list is still carried in SecurityPolicy and surfaced in
//     the security.json artifact (phase-09); live enforcement awaits either a
//     settings-file mechanism or the future external sandbox.
function buildSecureClaudeFlags(security: SecurityPolicy, cwd: string): string[] {
  const addDirs = security.filesystem.allowWrite
    .filter((p) => p !== cwd)
    .flatMap((p) => ["--add-dir", p]);

  const mcpFlags: string[] = [];
  if (security.mcp.mode !== "provider-default") {
    mcpFlags.push("--strict-mcp-config");
  }
  if (security.mcp.mode === "allowlist") {
    for (const path of security.mcp.allow) {
      mcpFlags.push("--mcp-config", path);
    }
  }

  return ["--permission-mode", "default", ...addDirs, "--disallowed-tools", "Bash", ...mcpFlags];
}

export function buildArgs(options: AgentRunOptions, resumeSessionId?: string): string[] {
  // `claude` requires `--verbose` whenever `--print` is paired with
  // `--output-format=stream-json`; without it the CLI exits with code 1.
  const common = ["--print", "--output-format", "stream-json", "--verbose"];

  const modeFlags = (() => {
    if (options.security.mode === "unsafe") {
      // `--permission-mode bypassPermissions` is required for non-interactive
      // runs in host-unrestricted mode: phax owns the worktree it spawns
      // claude in, so prompting for Write/Edit approval would deadlock the
      // headless session.
      return ["--permission-mode", "bypassPermissions"];
    }
    // secure / isolated (the CLI gates isolated before reaching here; treat as
    // secure for type totality).
    if (options.security.filesystem.allowWrite.length === 0) {
      throw new SecurityEnforcementError({
        message:
          "Claude Code secure mode requires at least one writable path in the security policy; refusing to run unrestricted.",
        provider: "claude-code",
        mode: options.security.mode,
      });
    }
    return buildSecureClaudeFlags(options.security, options.cwd);
  })();

  const args = [...common, ...modeFlags, "--model", options.model, "--effort", options.effort];
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
  | AgentInvocationError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError
> {
  let args: string[];
  try {
    args = buildArgs(options, resumeSessionId);
  } catch (err) {
    if (err instanceof SecurityEnforcementError) {
      return Effect.fail(err);
    }
    throw err;
  }
  return Effect.gen(function* () {
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnClaude(args, prompt, options.outputJsonlPath, options.cwd),
      catch: (err): AgentInvocationError =>
        new AgentInvocationError({
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
        new AgentInvocationError({
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
        new AgentSessionIdMissingError({
          message: "No result event with session_id found in claude output",
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
    }

    const sessionIdResult = decodeClaudeSessionId(found.sessionId);
    if (Either.isLeft(sessionIdResult)) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
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
