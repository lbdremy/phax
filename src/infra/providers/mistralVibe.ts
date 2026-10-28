import { Effect, Either } from "effect";
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentRunOptions,
  AgentRunResult,
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
import { vibeExportDirOf, vibeExportFileOf } from "../../domain/records/usage.js";
import type { SecurityPolicy } from "../../domain/security/types.js";
import { classifyRateLimit } from "../../schemas/claudeOutput.js";
import { decodeVibeExportText } from "../../schemas/vibeExport.js";
import {
  findVibeResultEvent,
  findVibeStreamHead,
  parseVibeVersion,
  type VibeVersion,
} from "../../schemas/vibeOutput.js";
import { persistSessionId } from "./sessionWriter.js";
import { writeAgentErrorLog } from "./agentErrorLog.js";
import { captureFromStore, isAbsence, notFound } from "./transcriptStore.js";

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
  // Model selection goes through modelEnvVar (VIBE_ACTIVE_MODEL) set by spawnVibe;
  // `vibe` has no `--target` flag, so it must not be added back to this argv.
  const args: string[] = [
    "-p",
    prompt,
    "--agent",
    entry.defaultAgent ?? "auto-approve",
    "--output",
    "streaming",
    // Each turn's export (usage, session id, outcome) lands beside its stream.
    ...(options.outputJsonlPath === undefined
      ? []
      : ["--output-dir", vibeExportDirOf(options.outputJsonlPath)]),
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

    // Guard against a vibe binary that prints an error and hangs without
    // exiting (e.g. when a required CLI flag is missing in the installed
    // version). PHAX_VIBE_SPAWN_TIMEOUT_MS can be set to cap the wall-clock
    // time; unset means no timeout (default for production runs).
    const killAfterMs =
      process.env["PHAX_VIBE_SPAWN_TIMEOUT_MS"] !== undefined
        ? Number(process.env["PHAX_VIBE_SPAWN_TIMEOUT_MS"])
        : undefined;
    const killTimer =
      killAfterMs !== undefined
        ? setTimeout(() => {
            proc.kill("SIGTERM");
          }, killAfterMs)
        : undefined;
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

// Vibe 3.0.3 is the first release whose headless turns write an export.json
// into --output-dir and whose secure controls phax relies on.
const MIN_VIBE_VERSION: VibeVersion = { major: 3, minor: 0, patch: 3 };
const MIN_VIBE_VERSION_TEXT = "3.0.3";
const VIBE_UPGRADE_HINT = "Upgrade it: uv tool upgrade mistral-vibe";
const VERSION_TIMEOUT_MS = 30_000;

const versionTextOf = (version: VibeVersion): string =>
  `${version.major}.${version.minor}.${version.patch}`;

function isBelowFloor(version: VibeVersion): boolean {
  if (version.major !== MIN_VIBE_VERSION.major) return version.major < MIN_VIBE_VERSION.major;
  if (version.minor !== MIN_VIBE_VERSION.minor) return version.minor < MIN_VIBE_VERSION.minor;
  return version.patch < MIN_VIBE_VERSION.patch;
}

function readVersionOutput(executable: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ["--version"],
      { timeout: VERSION_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout, stderr) => {
        const printed = `${stdout}${stderr}`.trim();
        // A binary that cannot run prints nothing; one that ran and failed
        // printed something, which the version parse then judges.
        if (error !== null && printed === "") reject(error);
        else resolve(printed);
      },
    );
  });
}

// What each executable printed for `--version`, read once per process. A read
// that failed is forgotten, so the next session asks again. Tests give each fake
// its own path, which is its own key.
const versionOutputs = new Map<string, Promise<string>>();

function versionOutputOf(executable: string): Promise<string> {
  const known = versionOutputs.get(executable);
  if (known !== undefined) return known;
  const read = readVersionOutput(executable);
  versionOutputs.set(executable, read);
  read.catch(() => versionOutputs.delete(executable));
  return read;
}

/** Refuses a vibe older than 3.0.3, or one whose `--version` cannot be read, before any session spawns. */
function requireSupportedVibe(
  executable: string,
  phaseFolderPath: string | undefined,
): Effect.Effect<void, AgentInvocationError> {
  const argv = [executable, "--version"];
  const refuse = (message: string): AgentInvocationError =>
    new AgentInvocationError({ message, argv, phaseFolderPath });
  return Effect.tryPromise({
    try: () => versionOutputOf(executable),
    catch: (err) =>
      refuse(
        `Could not run ${executable} --version: ${err instanceof Error ? err.message : String(err)}\nphax needs mistral-vibe ${MIN_VIBE_VERSION_TEXT} or later. ${VIBE_UPGRADE_HINT}`,
      ),
  }).pipe(
    Effect.flatMap((printed) => {
      const version = parseVibeVersion(printed);
      if (version === undefined) {
        return Effect.fail(
          refuse(
            `mistral-vibe printed ${JSON.stringify(printed)} for --version, which phax cannot read as a version; phax needs ${MIN_VIBE_VERSION_TEXT} or later.\n${VIBE_UPGRADE_HINT}`,
          ),
        );
      }
      return isBelowFloor(version)
        ? Effect.fail(
            refuse(
              `mistral-vibe ${versionTextOf(version)} is installed; phax needs ${MIN_VIBE_VERSION_TEXT} or later.\n${VIBE_UPGRADE_HINT}`,
            ),
          )
        : Effect.void;
    }),
  );
}

/**
 * A vibe session's transcript: the turn streams kept directly in the phase
 * folder (`request.phaseFolder`, no recursion) whose first decodable entry
 * carries the session id, ordered by that entry's `createdAt` and
 * concatenated byte for byte. A session no kept stream names (one the person
 * ran in vibe's own interface) is `not-found`. Vibe's home is never read.
 */
export function captureVibeTranscript(
  request: TranscriptRequest,
): Effect.Effect<TranscriptRead, never> {
  return captureFromStore(request.phaseFolder, request.sessionId, async (folder) => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (err) {
      if (isAbsence(err)) return notFound(`no phase folder ${folder}`);
      throw err;
    }
    const turns: { name: string; createdAt: number; bytes: Buffer }[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(join(folder, entry.name));
      } catch (err) {
        if (isAbsence(err)) continue;
        throw err;
      }
      const head = findVibeStreamHead(bytes.toString("utf8").split("\n"));
      if (head?.sessionId === request.sessionId) {
        turns.push({ name: entry.name, createdAt: head.createdAt, bytes });
      }
    }
    if (turns.length === 0) {
      return notFound(`no kept turn stream of vibe session ${request.sessionId} in ${folder}`);
    }
    turns.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
    return {
      status: "found",
      bytes: new Uint8Array(Buffer.concat(turns.map((turn) => turn.bytes))),
    };
  });
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
  const transcriptPath = options.outputJsonlPath;
  if (transcriptPath === undefined) {
    return Effect.fail(
      new AgentInvocationError({
        message:
          "A mistral-vibe turn needs a transcript path (outputJsonlPath): its export.json is written beside it.",
        phaseFolderPath: options.phaseFolderPath,
      }),
    );
  }
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
  const failInvocation = (message: string): AgentInvocationError =>
    new AgentInvocationError({ message, argv, phaseFolderPath: options.phaseFolderPath });

  return Effect.gen(function* () {
    yield* requireSupportedVibe(entry.executable, options.phaseFolderPath);

    yield* Effect.tryPromise({
      try: () => mkdir(vibeExportDirOf(transcriptPath), { recursive: true }),
      catch: wrapFsError,
    });

    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnVibe(entry, args, transcriptPath, options.cwd, options.model),
      catch: (err): AgentInvocationError => {
        writeAgentErrorLog(options.phaseFolderPath, {
          argv,
          stderr: err instanceof Error ? err.message : String(err),
        });
        return failInvocation(err instanceof Error ? err.message : String(err));
      },
    });

    if (exitCode !== 0) {
      const classification = classifyRateLimit(stderr, lines);
      if (classification !== undefined) {
        return yield* Effect.fail(rateLimitErrorFor(classification));
      }
      writeAgentErrorLog(options.phaseFolderPath, { argv, exitCode, stderr });
      return yield* Effect.fail(
        new AgentInvocationError({
          message: `vibe exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv,
          phaseFolderPath: options.phaseFolderPath,
        }),
      );
    }

    const found = findVibeResultEvent(lines);
    if (!found) {
      return yield* Effect.fail(
        failInvocation(
          `vibe's stream holds no assistant message with a text block, so there is no answer to read (stream: ${transcriptPath})`,
        ),
      );
    }

    const exportPath = vibeExportFileOf(transcriptPath);
    const exportText = yield* Effect.tryPromise({
      try: () => readFile(exportPath, "utf8"),
      catch: (err) =>
        failInvocation(
          isAbsence(err)
            ? `vibe wrote no export.json (missing Vibe export at ${exportPath})`
            : `could not read the Vibe export at ${exportPath}: ${err instanceof Error ? err.message : String(err)}`,
        ),
    });
    const exported = decodeVibeExportText(exportText);
    if (Either.isLeft(exported)) {
      return yield* Effect.fail(
        failInvocation(
          `invalid Vibe export at ${exportPath} (${exported.left.reason}): ${exported.left.detail}`,
        ),
      );
    }

    const sessionIdResult = decodeClaudeSessionId(exported.right.session_id);
    if (Either.isLeft(sessionIdResult)) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: `Invalid session_id in the Vibe export at ${exportPath}: "${exported.right.session_id}"`,
          outputPath: transcriptPath,
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
      outputPath: transcriptPath,
      finalText: found.finalText,
    };
  });
}
