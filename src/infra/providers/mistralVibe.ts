import { Effect, Either } from "effect";
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
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
import { vibeExportDirOf, vibeExportFileOf } from "../../domain/records/usage.js";
import { sessionFailureError } from "../../domain/session/failureError.js";
import {
  readVibeOutcome,
  type SessionEnd,
  type VibeExportRead,
} from "../../domain/session/outcome.js";
import {
  buildSealedVibeFlags,
  buildVibeFlags,
  isConfinedVibeSession,
  VIBE_PROJECT_CONFIG_DIRS,
  vibeAcceptEditsOverridePath,
  vibeConfigMismatch,
  vibeExtraRoots,
  type VibeFlags,
  type VibeFlagsInput,
} from "../../domain/session/vibeFlags.js";
import { decodeVibeOutcomeText } from "../../schemas/vibeExport.js";
import {
  findVibeStreamHead,
  parseVibeVersion,
  type VibeVersion,
} from "../../schemas/vibeOutput.js";
import { persistSessionId } from "./sessionWriter.js";
import { answerSessionId, failSession, sessionEndOf, writeAgentErrorLog } from "./agentErrorLog.js";
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
  readonly stderr: string;
  /** How the process ended: its exit code, the signal that stopped it, or the spawn timeout. */
  readonly end: SessionEnd;
}

// Each invocation carries its own confinement, built by `buildVibeFlags`
// (src/domain/session/vibeFlags.ts); no Vibe config file is written. A secure
// session runs under `--agent accept-edits`, scoped to `--workdir` plus one
// `--add-dir` per extra writable root, with VIBE_OUTSIDE_WORKDIR=deny,
// VIBE_BYPASS_TOOL_PERMISSIONS=false and a VIBE_TOOLS that allowlists exactly
// the phase's agent commands for bash and empties every file tool's allowlist,
// so a looser user config cannot widen it. The provider entry's `defaultAgent`
// applies to unsafe sessions only, which keep auto-approve and `--trust`.
// Network scoping has no per-invocation surface: the resolved policy is
// recorded in security.json.
//
// What the environment cannot hold is checked around the turn. Before it, a
// confined session is refused when a user `accept-edits` profile would replace
// Vibe's built-in one, and a secure one when an --add-dir root holds Vibe
// config (Vibe trusts and loads it). After it, the config the turn ran with
// (its export's `config`) is read back against what phax set, and a turn that
// ran under anything else is refused: a resumed session can bring back the
// agent it last ran with.
function vibeFlagsInputOf(entry: VibeProviderEntry, options: AgentRunOptions): VibeFlagsInput {
  return {
    security: options.security,
    cwd: options.cwd,
    agentCommands: options.agentCommands ?? [],
    unsafeAgent: entry.defaultAgent,
    readOnly: options.readOnly,
  };
}

function vibeFlagsOf(entry: VibeProviderEntry, options: AgentRunOptions): VibeFlags {
  return buildVibeFlags(vibeFlagsInputOf(entry, options));
}

// Whether a Vibe config path is there for Vibe to load. One this process may
// not reach counts as absent: Vibe runs as the same user and cannot load it
// either, so a VIBE_HOME phax cannot read refuses nothing.
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if (isAbsence(err)) return false;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") return false;
    throw err;
  }
}

/**
 * Why a confined session must not start, or undefined: a user profile that
 * replaces the built-in `accept-edits`, or (secure sessions) Vibe config under
 * an --add-dir root.
 */
async function confinementRefusal(input: VibeFlagsInput): Promise<string | undefined> {
  if (!isConfinedVibeSession(input)) return undefined;
  const override = vibeAcceptEditsOverridePath(process.env, homedir());
  if (override !== null && (await exists(override))) {
    return `${override} replaces Vibe's built-in accept-edits agent, which phax's secure and read-only Vibe sessions run under, so phax cannot vouch for their confinement. Rename it (for example to my-accept-edits.toml) and pick it with --agent my-accept-edits in your own sessions.`;
  }
  if (input.readOnly === true) return undefined;
  for (const root of vibeExtraRoots(input.security, input.cwd)) {
    for (const dir of VIBE_PROJECT_CONFIG_DIRS) {
      const path = join(root, dir);
      if (await exists(path)) {
        return `${path} is Vibe config under a writable root phax opens with --add-dir, which Vibe trusts and loads (hooks, agents, tools), so phax cannot vouch for the session's confinement. Move it out of ${root}, or drop ${root} from security.filesystem.allowWrite.`;
      }
    }
  }
  return undefined;
}

export function buildVibeArgs(
  entry: VibeProviderEntry,
  prompt: string,
  options: AgentRunOptions,
  resumeSessionId?: string,
): string[] {
  const flags = vibeFlagsOf(entry, options);
  // Model selection goes through modelEnvVar (VIBE_ACTIVE_MODEL) set by spawnVibe;
  // `vibe` has no `--target` flag, so it must not be added back to this argv.
  const args: string[] = [
    "-p",
    prompt,
    ...flags.agent,
    "--output",
    "streaming",
    // Each turn's export (usage, session id, outcome) lands beside its stream.
    ...(options.outputJsonlPath === undefined
      ? []
      : ["--output-dir", vibeExportDirOf(options.outputJsonlPath)]),
    ...flags.scope,
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
  envAdditions: Readonly<Record<string, string>>,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let stderrBuf = "";
    let timedOut = false;

    let writeStream: ReturnType<typeof createWriteStream> | undefined;
    if (outputJsonlPath) {
      mkdir(dirname(outputJsonlPath), { recursive: true }).catch(() => undefined);
      writeStream = createWriteStream(outputJsonlPath, { flags: "w" });
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...envAdditions,
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

    proc.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (stdoutBuf.trim()) lines.push(stdoutBuf);
      const end: SessionEnd = timedOut ? { kind: "timed-out" } : sessionEndOf(code, signal);
      const result = { lines, stderr: stderrBuf, end };
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
            timedOut = true;
            proc.kill("SIGTERM");
          }, killAfterMs)
        : undefined;
  });
}

/** What reading a turn's `export.json` gave: its text, or why there is none. */
async function readVibeExport(path: string): Promise<VibeExportRead> {
  try {
    return { kind: "text", path, text: await readFile(path, "utf8") };
  } catch (err) {
    return isAbsence(err)
      ? { kind: "absent", path }
      : { kind: "unreadable", path, detail: err instanceof Error ? err.message : String(err) };
  }
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
  const refuse = (message: string): AgentInvocationError => {
    writeAgentErrorLog(phaseFolderPath, { argv, stderr: message });
    return new AgentInvocationError({ message, argv, phaseFolderPath });
  };
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

/**
 * A one-message sealed Vibe completion: every tool disabled, no session
 * recorded and no export read. The answer comes from the stream.
 */
export function runVibeCompletion(
  prompt: string,
  options: CompletionOptions,
  entry: VibeProviderEntry,
): Effect.Effect<
  CompletionResult,
  AgentInvocationError | AgentSessionFailedError | RateLimitError | UsageLimitError | FsError
> {
  const flags = buildSealedVibeFlags(options.cwd);
  const args = ["-p", prompt, ...flags.agent, "--output", "streaming", ...flags.scope];
  const argv = [entry.executable, ...args];
  return Effect.gen(function* () {
    yield* requireSupportedVibe(entry.executable, undefined);
    const { lines, stderr, end } = yield* Effect.tryPromise({
      try: () => spawnVibe(entry, args, undefined, options.cwd, options.model, flags.env),
      catch: (err): AgentInvocationError =>
        new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv,
        }),
    });
    const outcome = readVibeOutcome({ lines, stderr, end }, { kind: "not-requested" });
    if (outcome.kind === "failure") {
      return yield* Effect.fail(
        sessionFailureError(outcome.failure, { agentErrorLog: null, transcript: null }),
      );
    }
    return { finalText: outcome.text };
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
  | AgentSessionFailedError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError
> {
  const transcriptPath = options.outputJsonlPath;
  if (transcriptPath === undefined) {
    const message =
      "A mistral-vibe turn needs a transcript path (outputJsonlPath): its export.json is written beside it.";
    writeAgentErrorLog(options.phaseFolderPath, { argv: [entry.executable], stderr: message });
    return Effect.fail(
      new AgentInvocationError({ message, phaseFolderPath: options.phaseFolderPath }),
    );
  }
  const flagsInput = vibeFlagsInputOf(entry, options);
  let args: string[];
  let envAdditions: Readonly<Record<string, string>>;
  try {
    args = buildVibeArgs(entry, prompt, options, resumeSessionId);
    envAdditions = vibeFlagsOf(entry, options).env;
  } catch (err) {
    if (err instanceof SecurityEnforcementError) {
      return Effect.fail(err);
    }
    throw err;
  }
  const argv = [entry.executable, ...args];
  // Every refusal that names the phase folder writes agent-error.log too: the
  // CLI points at that file whenever the error names the folder.
  const failInvocation = (message: string): AgentInvocationError => {
    writeAgentErrorLog(options.phaseFolderPath, { argv, stderr: message });
    return new AgentInvocationError({ message, argv, phaseFolderPath: options.phaseFolderPath });
  };

  return Effect.gen(function* () {
    yield* requireSupportedVibe(entry.executable, options.phaseFolderPath);

    const refusal = yield* Effect.tryPromise({
      try: () => confinementRefusal(flagsInput),
      catch: wrapFsError,
    });
    if (refusal !== undefined) {
      return yield* Effect.fail(
        new SecurityEnforcementError({
          message: refusal,
          provider: "mistral-vibe",
          mode: options.security.mode,
        }),
      );
    }

    // A turn that reuses a transcript path (a resumed phase re-runs into
    // output.jsonl) must not read the previous turn's export.
    const exportPath = vibeExportFileOf(transcriptPath);
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(vibeExportDirOf(transcriptPath), { recursive: true });
        await rm(exportPath, { force: true });
      },
      catch: wrapFsError,
    });

    const { lines, stderr, end } = yield* Effect.tryPromise({
      try: () => spawnVibe(entry, args, transcriptPath, options.cwd, options.model, envAdditions),
      catch: (err): AgentInvocationError =>
        failInvocation(err instanceof Error ? err.message : String(err)),
    });

    const exportRead = yield* Effect.promise(() => readVibeExport(exportPath));
    const outcome = readVibeOutcome({ lines, stderr, end }, exportRead);

    // The config the turn ran with is checked before its outcome is honoured:
    // an answer's always, a failure's whenever its export decodes with one. A
    // mismatch refuses the turn, whatever the reader made of it.
    const decoded = exportRead.kind === "text" ? decodeVibeOutcomeText(exportRead.text) : undefined;
    if (decoded !== undefined && Either.isRight(decoded)) {
      const { config } = decoded.right;
      if (outcome.kind === "answer" || (config !== undefined && config !== null)) {
        const mismatch = vibeConfigMismatch(flagsInput, config);
        if (mismatch !== undefined) {
          return yield* Effect.fail(
            failInvocation(
              `vibe ran this turn under a config phax did not set (${mismatch}, read from ${exportPath}), so its result is refused. A Vibe agent profile or a resumed session's restored agent can override phax's settings.`,
            ),
          );
        }
      }
    }

    const failed = {
      argv,
      end,
      stderr,
      phaseFolderPath: options.phaseFolderPath,
      transcript: transcriptPath,
    };
    if (outcome.kind === "failure") {
      return yield* Effect.fail(failSession(outcome.failure, failed));
    }
    const sessionIdResult = answerSessionId(outcome);
    if (Either.isLeft(sessionIdResult)) {
      const failure =
        outcome.sessionId === null
          ? sessionIdResult.left
          : {
              ...sessionIdResult.left,
              message: `Invalid session_id in the Vibe export at ${exportPath}: "${outcome.sessionId}"`,
            };
      return yield* Effect.fail(failSession(failure, failed));
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
      finalText: outcome.text,
    };
  });
}
