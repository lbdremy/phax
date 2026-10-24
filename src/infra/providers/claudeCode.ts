import { Effect, Either } from "effect";
import { spawn } from "node:child_process";
import { createWriteStream, realpathSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AgentRunOptions,
  AgentRunResult,
  CompletionOptions,
  CompletionResult,
  ProbeOptions,
  ProbeResult,
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
  claudePermissionFlags,
  claudeReadOnlyFlags,
} from "../../domain/session/claudePermissionFlags.js";
import {
  classifyRateLimit,
  findResultEvent,
  hasErroredResultEvent,
  type RateLimitClassification,
} from "../../schemas/claudeOutput.js";
import { buildSkillEditGrantSettings } from "./claudeSkillEditSettings.js";
import { persistSessionId } from "./sessionWriter.js";
import { writeAgentErrorLog } from "./agentErrorLog.js";
import {
  captureFromStore,
  claudeProjectSlug,
  listStoreNames,
  notFound,
  readStoreFile,
} from "./transcriptStore.js";

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

// Grace between asking a timed-out probe to stop and forcing it, so a process
// that ignores SIGTERM never outlives the CLI.
const SIGKILL_GRACE_MS = 5_000;

/** `timed-out` only when `timeoutMs` is given and the process outlives it. */
function spawnClaude(
  args: readonly string[],
  prompt: string,
  outputJsonlPath: string | undefined,
  cwd: string | undefined,
): Promise<SpawnResult>;
function spawnClaude(
  args: readonly string[],
  prompt: string,
  outputJsonlPath: string | undefined,
  cwd: string | undefined,
  timeoutMs: number,
): Promise<SpawnResult | "timed-out">;
function spawnClaude(
  args: readonly string[],
  prompt: string,
  outputJsonlPath: string | undefined,
  cwd: string | undefined,
  timeoutMs?: number,
): Promise<SpawnResult | "timed-out"> {
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

    // Resolving on the timer rather than waiting for `close` means a child
    // that ignores SIGTERM still frees the caller; the later `close` lands on
    // an already-settled promise and is a no-op.
    const killTimer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            proc.kill("SIGTERM");
            setTimeout(() => proc.kill("SIGKILL"), SIGKILL_GRACE_MS).unref();
            writeStream?.end();
            resolve("timed-out");
          }, timeoutMs)
        : undefined;

    proc.on("close", (code) => {
      clearTimeout(killTimer);
      if (stdoutBuf.trim()) lines.push(stdoutBuf);
      const result = { lines, exitCode: code ?? 1, stderr: stderrBuf };
      // Resolve once the stream is flushed: the cost ledger reads it next.
      if (writeStream === undefined) resolve(result);
      else writeStream.end(() => resolve(result));
    });

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      writeStream?.end();
      reject(err);
    });
  });
}

// The hook's absolute `if` rule must match the path Claude Code resolves, so a
// worktree reached through a symlink (macOS $TMPDIR, a relocated state root)
// is resolved first. A root that cannot be resolved is used as given: the rule
// then fails closed (the edit is denied), same as no grant.
function resolveWorktreeRoot(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

export function buildArgs(options: AgentRunOptions, resumeSessionId?: string): string[] {
  // `claude` requires `--verbose` whenever `--print` is paired with
  // `--output-format=stream-json`; without it the CLI exits with code 1.
  const common = ["--print", "--output-format", "stream-json", "--verbose"];

  // A read-only session writes nothing, so it needs no writable path and
  // takes no skill grant; its agent commands are its only shell.
  if (options.readOnly === true) {
    const args = [
      ...common,
      ...claudeReadOnlyFlags([], options.agentCommands ?? []),
      "--model",
      options.model,
      "--effort",
      options.effort,
    ];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    return args;
  }

  // secure / isolated (the CLI gates isolated before reaching here; treat as
  // secure for type totality) needs a writable path; unsafe needs none.
  if (options.security.mode !== "unsafe" && options.security.filesystem.allowWrite.length === 0) {
    throw new SecurityEnforcementError({
      message:
        "Claude Code secure mode requires at least one writable path in the security policy; refusing to run unrestricted.",
      provider: "claude-code",
      mode: options.security.mode,
    });
  }
  const skillEditGrants = options.skillEditGrants ?? [];
  const modeFlags = claudePermissionFlags({
    security: options.security,
    cwd: options.cwd,
    agentCommands: options.agentCommands ?? [],
    grantSettings:
      options.security.mode === "unsafe" || skillEditGrants.length === 0
        ? undefined
        : buildSkillEditGrantSettings(resolveWorktreeRoot(options.cwd), skillEditGrants),
  });

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

/**
 * Build the sealed argument set for a tool-less model completion call.
 *
 * Security guarantees that are intrinsic to this arg set (not configurable):
 *   --permission-mode default  → any tool attempt auto-denies in headless --print
 *   --allowedTools ""          → empty allowlist (nothing explicitly permitted)
 *   --disallowed-tools Bash,WebFetch,WebSearch → explicit deny for high-risk tools
 *   --strict-mcp-config        → no MCP servers loaded
 *   no --add-dir               → no writable paths granted
 */
export function buildCompletionArgs(options: CompletionOptions): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "default",
    "--allowedTools",
    "",
    "--disallowed-tools",
    "Bash,WebFetch,WebSearch",
    "--strict-mcp-config",
    "--model",
    options.model,
    "--effort",
    options.effort,
  ];
}

export function runClaudeCompletion(
  prompt: string,
  options: CompletionOptions,
): Effect.Effect<
  CompletionResult,
  AgentInvocationError | RateLimitError | UsageLimitError | FsError
> {
  const args = buildCompletionArgs(options);
  return Effect.gen(function* () {
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnClaude(args, prompt, undefined, options.cwd),
      catch: (err): AgentInvocationError =>
        new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv: ["claude", ...args],
        }),
    });

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
        new AgentInvocationError({
          message: "No result event found in claude completion output",
          argv: ["claude", ...args],
        }),
      );
    }

    return { finalText: found.finalText };
  });
}

/**
 * The sealed completion flags plus `--no-session-persistence` and `--tools ""`,
 * which leaves the probe no built-in tool at all, read-only ones included.
 * With no tool the reply is a single turn; `--max-turns` is not passed because
 * Claude Code's help does not list it. The user's settings still load: they
 * can hold the authentication (`apiKeyHelper`) the verdict must see.
 */
export function buildProbeArgs(options: Pick<ProbeOptions, "model" | "effort">): string[] {
  return [
    ...buildCompletionArgs({
      provider: "claude-code",
      model: options.model,
      effort: options.effort,
      cwd: tmpdir(),
    }),
    "--no-session-persistence",
    "--tools",
    "",
  ];
}

/**
 * Run the probe from the OS temp directory, so no project's CLAUDE.md or
 * settings load and nothing is written to a repository. Returns the lines,
 * the exit code whatever that code is, and stderr, or `timed-out` once the
 * probe is stopped at its timeout: rate limits are not classified here.
 */
export function runClaudeProbe(
  prompt: string,
  options: ProbeOptions,
): Effect.Effect<ProbeResult, AgentInvocationError> {
  const args = buildProbeArgs(options);
  return Effect.tryPromise({
    try: () => spawnClaude(args, prompt, undefined, tmpdir(), options.timeoutMs),
    catch: (err): AgentInvocationError =>
      new AgentInvocationError({
        message: err instanceof Error ? err.message : String(err),
        argv: ["claude", ...args],
      }),
  }).pipe(
    Effect.map(
      (spawned): ProbeResult =>
        spawned === "timed-out"
          ? { kind: "timed-out" }
          : {
              kind: "ended",
              lines: spawned.lines,
              exitCode: spawned.exitCode,
              stderr: spawned.stderr,
            },
    ),
  );
}

/**
 * A Claude Code session's transcript, `<claude root>/projects/<slug>/<id>.jsonl`.
 * The slug is that of the worktree as given, then of its realpath (macOS
 * resolves `/var` to `/private/var`, and Claude Code files sessions under the
 * resolved path); failing both, the first project folder holding `<id>.jsonl`.
 */
export function captureClaudeTranscript(
  claudeRoot: string | null,
  request: TranscriptRequest,
): Effect.Effect<TranscriptRead, never> {
  return captureFromStore(claudeRoot, request.sessionId, async (root) => {
    const projects = join(root, "projects");
    const file = `${request.sessionId}.jsonl`;
    const slugs = [claudeProjectSlug(request.cwd)];
    const real = await realpath(request.cwd).catch(() => request.cwd);
    if (claudeProjectSlug(real) !== slugs[0]) slugs.push(claudeProjectSlug(real));
    for (const slug of slugs) {
      const read = await readStoreFile(join(projects, slug, file));
      if (read.status === "found" || read.reason === "unreadable") return read;
    }
    const names = await listStoreNames(projects);
    if (names === "absent") return notFound(`no Claude Code projects folder at ${projects}`);
    for (const name of names) {
      const read = await readStoreFile(join(projects, name, file));
      if (read.status === "found") return read;
    }
    return notFound(`no transcript for session ${request.sessionId} under ${projects}`);
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
      catch: (err): AgentInvocationError => {
        writeAgentErrorLog(options.phaseFolderPath, {
          argv: ["claude", ...args],
          stderr: err instanceof Error ? err.message : String(err),
        });
        return new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv: ["claude", ...args],
          phaseFolderPath: options.phaseFolderPath,
        });
      },
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
      writeAgentErrorLog(options.phaseFolderPath, { argv: ["claude", ...args], exitCode, stderr });
      return yield* Effect.fail(
        new AgentInvocationError({
          message: `claude exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv: ["claude", ...args],
          phaseFolderPath: options.phaseFolderPath,
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
