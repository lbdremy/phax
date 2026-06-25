import { Effect, Either } from "effect";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AgentRunOptions,
  AgentRunResult,
  CompletionOptions,
  CompletionResult,
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
import type { SecurityPolicy } from "../../domain/security/types.js";
import { classifyRateLimit } from "../../schemas/claudeOutput.js";
import { findCodexResultEvent, hasCodexErroredResultEvent } from "../../schemas/codexOutput.js";
import { persistSessionId } from "./sessionWriter.js";
import { writeAgentErrorLog } from "./agentErrorLog.js";

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

/**
 * Map a resolved effort (already an openai-gpt level: low|medium|high|xhigh,
 * with the legacy off|max kept as safe synonyms) to the value codex accepts
 * for `model_reasoning_effort`. Codex does not accept `xhigh`; clamp it to
 * `high`.
 */
function mapReasoningEffort(effort: string): string {
  switch (effort) {
    case "off":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return "medium";
  }
}

// Centralized secure-mode Codex flag set. Runbook 04b will validate which of
// these the installed `codex` CLI actually enforces; corrections feed back
// here. Today's surface:
//   -c sandbox_mode="workspace-write"
//       Restricts subprocess writes to the workspace + writable_roots and (with
//       network_access=false) blocks subprocess network. Replaces the
//       --dangerously-bypass-approvals-and-sandbox vector used in unsafe mode.
//       Uses the `-c` config-override form rather than the `-s/--sandbox` flag
//       because `codex exec resume` (verified 0.136.0) does NOT accept
//       `--sandbox` — passing it makes clap reject the whole vector ("unexpected
//       argument '--sandbox'") and the secure handoff resume exits with code 2.
//       The `sandbox_mode` config key is accepted by both `codex exec` and
//       `codex exec resume` and is verified recognized under `--strict-config`.
//   -c approval_policy="never"
//       Non-interactive approval that does NOT silently escape the sandbox: a
//       sandbox denial fails the action instead of escalating to host-level
//       execution. NOTE: `codex exec` (verified 0.136.0 in runbook 04b) has NO
//       `-a`/`--ask-for-approval` flag — passing `-a never` makes clap reject
//       the whole vector ("unexpected argument '-a'"), so secure runs never
//       start. The config-key form `approval_policy="never"` is the exec-
//       compatible equivalent and was confirmed live to block an out-of-root
//       write without re-running it unsandboxed.
//   -c sandbox_workspace_write.writable_roots=[...]
//       JSON-encoded list of writable roots (worktree + ~/.phax + configured).
//       Codex de-duplicates roots; including cwd is harmless.
//   -c sandbox_workspace_write.network_access=true|false
//       Controls subprocess network. provider-only → false (most conservative;
//       the codex parent process still reaches api.openai.com outside the
//       sandbox boundary). dev-allowlist/open → true. Codex offers no
//       domain-level allowlist, and the policy carries none — only the binary
//       network.profile maps here (04b confirmed no provider enforces domains).
//
// Not yet expressible via Codex CLI flags (tracked in 04b):
//   - Per-command allowlist: Codex provides no command-level restriction flag.
//     The frozen agentCommands set (config ∪ gates) is recorded in security.json
//     with enforcement: "none"; the sandbox boundary is the effective constraint.
//   - MCP scoping: codex configures MCP via [mcp_servers.*] tables in
//     ~/.codex/config.toml. There is no single-flag disable that PHAX can rely
//     on across versions. The resolved mcp policy is carried on SecurityPolicy
//     and recorded in security.json; live enforcement awaits 04b confirmation
//     of an override surface (or the future external sandbox).
function buildCodexSecurityFlags(security: SecurityPolicy): string[] {
  if (security.mode === "unsafe") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  // secure / isolated (CLI gates isolated before reaching here; treat as
  // secure for type totality).
  if (security.filesystem.allowWrite.length === 0) {
    throw new SecurityEnforcementError({
      message:
        "Codex CLI secure mode requires at least one writable path in the security policy; refusing to run with danger-full-access.",
      provider: "codex-cli",
      mode: security.mode,
    });
  }

  const writableRootsJson = JSON.stringify([...security.filesystem.allowWrite]);
  const networkAccess = security.network.profile !== "provider-only";

  return [
    "-c",
    `sandbox_mode="workspace-write"`,
    "-c",
    `approval_policy="never"`,
    "-c",
    `sandbox_workspace_write.writable_roots=${writableRootsJson}`,
    "-c",
    `sandbox_workspace_write.network_access=${networkAccess}`,
  ];
}

export function buildCodexArgs(
  entry: CodexProviderEntry,
  options: AgentRunOptions,
  resumeSessionId?: string,
): string[] {
  const model = entry.families?.["openai-gpt"]?.model ?? options.model;
  const securityFlags = buildCodexSecurityFlags(options.security);
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

export function buildCodexCompletionArgs(
  entry: CodexProviderEntry,
  options: CompletionOptions,
): string[] {
  const model = entry.families?.["openai-gpt"]?.model ?? options.model;
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
