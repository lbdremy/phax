import { Effect, Either } from "effect";
import { join } from "node:path";
import type { ClaudeSessionId } from "../domain/branded.js";
import {
  type ClaudeInvocationError,
  type ClaudeSessionIdMissingError,
  GateFailedError,
} from "../domain/errors.js";
import type { PhaseState } from "../domain/state.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { decodePhaseStatus, encodePhaseStatus } from "../schemas/status.js";
import { runGates, type GateOutcome } from "./gates.js";

function updatePhaseState(
  phaseFolderPath: string,
  newState: PhaseState,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(phaseFolderPath, "status.json");
    const raw = yield* fs.readText(statusPath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    const decoded = decodePhaseStatus(parsed);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        state: newState,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
}

function buildFixPrompt(gateError: GateFailedError, logContent: string, attempt: number): string {
  return [
    "# Gate checks failed — fix required",
    "",
    `Gate run (attempt ${attempt}) failed.`,
    "",
    `**Failed command:** \`${gateError.command}\``,
    `**Exit code:** ${gateError.exitCode}`,
    "",
    "## Gate output",
    "",
    "```",
    logContent,
    "```",
    "",
    "## Required action",
    "",
    "Fix all issues revealed by the gate output above.",
    "Make the minimum changes required to pass the gate.",
    "Do not change unrelated code or introduce new features.",
    "",
    "The gate run will be re-attempted automatically after your changes.",
  ].join("\n");
}

export interface RunGatesWithFixLoopOptions {
  readonly commands: readonly string[];
  readonly cwd: string;
  readonly phaseFolderPath: string;
  readonly sessionId: ClaudeSessionId;
  readonly agentOptions: AgentRunOptions;
  readonly maxFixAttempts: number;
}

export function runGatesWithFixLoop(
  opts: RunGatesWithFixLoopOptions,
): Effect.Effect<
  GateOutcome,
  GateFailedError | FsError | ShellError | ClaudeInvocationError | ClaudeSessionIdMissingError,
  Shell | FileSystem | Backend
> {
  const { commands, cwd, phaseFolderPath, sessionId, agentOptions, maxFixAttempts } = opts;

  function logPath(attempt: number): string {
    return join(phaseFolderPath, `checks-attempt-${String(attempt).padStart(2, "0")}.log`);
  }

  function loop(
    attempt: number,
    currentSessionId: ClaudeSessionId,
  ): Effect.Effect<
    GateOutcome,
    GateFailedError | FsError | ShellError | ClaudeInvocationError | ClaudeSessionIdMissingError,
    Shell | FileSystem | Backend
  > {
    return Effect.gen(function* () {
      const gateResult = yield* Effect.either(runGates(commands, cwd, logPath(attempt)));

      if (Either.isRight(gateResult)) {
        return gateResult.right;
      }

      const error = gateResult.left;

      if (!(error instanceof GateFailedError)) {
        return yield* Effect.fail(error);
      }

      yield* updatePhaseState(phaseFolderPath, "gates_failed");

      if (attempt > maxFixAttempts) {
        yield* updatePhaseState(phaseFolderPath, "failed");
        return yield* Effect.fail(error);
      }

      yield* updatePhaseState(phaseFolderPath, "fixing");

      const fs = yield* FileSystem;
      const logContent = yield* fs.readText(logPath(attempt));
      const fixPrompt = buildFixPrompt(error, logContent, attempt);

      const backend = yield* Backend;
      const fixResult = yield* backend.resumeAgentSession(currentSessionId, fixPrompt, {
        model: agentOptions.model,
        effort: agentOptions.effort,
        cwd: agentOptions.cwd,
        outputJsonlPath: join(
          phaseFolderPath,
          `fix-attempt-${String(attempt).padStart(2, "0")}.jsonl`,
        ),
        phaseFolderPath: agentOptions.phaseFolderPath,
      });

      yield* updatePhaseState(phaseFolderPath, "running");

      return yield* loop(attempt + 1, fixResult.sessionId);
    });
  }

  return loop(1, sessionId);
}
