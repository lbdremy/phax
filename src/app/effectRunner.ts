import { Effect, Either } from "effect";
import { dirname, join } from "node:path";
import type { RunId } from "../domain/branded.js";
import type { PhaxCommand } from "../domain/effects.js";
import { RegistryCorruptionError, SetupCommandFailedError } from "../domain/errors.js";
import type { SemanticTelemetryEvent } from "../domain/telemetry/events.js";
import {
  makeAdapterCallFailedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  decodePhaseStatus,
  decodeRunStatus,
  encodePhaseStatus,
  encodeRunStatus,
} from "../schemas/status.js";
import { setRunStatus } from "./registry.js";
import { writeResumeInstructions } from "./resumeInstructions.js";
import { generateReviewHandoff } from "./reviewHandoff.js";

export interface EffectRunnerContext {
  readonly runPath: string;
  readonly phaseFolderPath?: string | undefined;
  readonly phaseId?: string | undefined;
  readonly shortName: string;
}

function persistState(
  ctx: EffectRunnerContext,
  cmd: Extract<PhaxCommand, { type: "PersistState" }>,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const now = new Date().toISOString();

    if (cmd.patch.run !== undefined) {
      const path = join(ctx.runPath, "run-status.json");
      const raw = yield* fs.readText(path);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return;
      }
      const decoded = decodeRunStatus(parsed);
      if (Either.isRight(decoded)) {
        const updated = { ...decoded.right, ...cmd.patch.run, updatedAt: now };
        yield* fs.writeAtomic(path, JSON.stringify(encodeRunStatus(updated), null, 2));
      }
    }

    if (cmd.patch.phase !== undefined && ctx.phaseFolderPath !== undefined) {
      const path = join(ctx.phaseFolderPath, "status.json");
      const raw = yield* fs.readText(path);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return;
      }
      const decoded = decodePhaseStatus(parsed);
      if (Either.isRight(decoded)) {
        const updated = { ...decoded.right, ...cmd.patch.phase, updatedAt: now };
        yield* fs.writeAtomic(path, JSON.stringify(encodePhaseStatus(updated), null, 2));
      }
    }
  });
}

function recordCommitMetadata(
  ctx: EffectRunnerContext,
  hash: string,
): Effect.Effect<void, FsError, FileSystem> {
  return persistState(ctx, {
    type: "PersistState",
    patch: { phase: { commitHash: hash } },
  });
}

function mapEmitTraceToSemantic(
  cmd: Extract<PhaxCommand, { type: "EmitTrace" }>,
  runId: RunId,
): SemanticTelemetryEvent | null {
  switch (cmd.name) {
    case "rate_limit.detected":
      return makeAdapterCallFailedTelemetryEvent({
        runId,
        adapter: "claude-code-cli",
        operation: "agent.run",
        exitCode: -1,
        stderrExcerpt: "",
        actual: "rate_limited",
      });
    case "resume.available":
      return makeStepCompletedTelemetryEvent({
        runId,
        step: "resume.notify",
        result: "success",
      });
    case "archive.completed":
      return makeStepCompletedTelemetryEvent({
        runId,
        step: "archive",
        result: "success",
      });
    default:
      return null;
  }
}

function parseCommandTokens(raw: string): readonly [string, ...string[]] | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (parts.length === 0 || first === undefined) return null;
  return [first, ...parts.slice(1)];
}

function runCleanupShell(
  cmd: Extract<PhaxCommand, { type: "RunCleanupShell" }>,
): Effect.Effect<void, ShellError | SetupCommandFailedError, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    for (const raw of cmd.commands) {
      const tokens = parseCommandTokens(raw);
      if (tokens === null) continue;
      const result = yield* shell.run({ command: tokens, cwd: cmd.cwd });
      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new SetupCommandFailedError({
            message: `Cleanup command failed: ${raw} (exit ${result.exitCode})`,
            command: raw,
            exitCode: result.exitCode,
            stderr: result.stderr,
          }),
        );
      }
    }
  });
}

/**
 * Interpret a single PhaxCommand. The runner is the only place outside the
 * dispatcher that talks to the persistence layer for status JSON files,
 * preserving the single-writer invariant (phase-07 will fence it in tests).
 */
export function run(
  cmd: PhaxCommand,
  ctx: EffectRunnerContext,
): Effect.Effect<
  void,
  FsError | ShellError | GitError | SetupCommandFailedError | RegistryCorruptionError,
  FileSystem | Git | Shell | SystemTelemetry
> {
  switch (cmd.type) {
    case "PersistState":
      return persistState(ctx, cmd);
    case "EmitTrace":
      return Effect.gen(function* () {
        const telemetry = yield* SystemTelemetry;
        const runId = ctx.shortName as unknown as RunId;
        const semanticEvent = mapEmitTraceToSemantic(cmd, runId);
        if (semanticEvent !== null) {
          yield* telemetry.recordEvent(semanticEvent);
        }
      });
    case "WriteResumeInstructions":
      return writeResumeInstructions({
        runPath: ctx.runPath,
        shortName: ctx.shortName,
        reason: cmd.ctx.reason,
        kind: cmd.ctx.kind,
        resetAt: cmd.ctx.kind === "gates_exhausted" ? undefined : cmd.ctx.resetAt,
        phaseId: cmd.ctx.phaseId,
        worktreePath: cmd.ctx.worktreePath,
        sessionId: cmd.ctx.sessionId,
        rawMessage: cmd.ctx.kind === "gates_exhausted" ? undefined : cmd.ctx.rawMessage,
      }).pipe(Effect.asVoid);
    case "RunCleanupShell":
      return runCleanupShell(cmd);
    case "WriteAtomic":
      return Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* fs.writeAtomic(cmd.path, cmd.content);
      });
    case "RecordCommitMetadata":
      return recordCommitMetadata(ctx, cmd.hash);
    case "MoveRunToArchive":
      return Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* fs.mkdirp(dirname(cmd.to));
        yield* fs.rename(cmd.from, cmd.to);
      });
    case "OpenRunReview":
      // allowPartial: true here because pre-committed phases may lack file-reconciliation.json.
      // Phase-05 switches to allowPartial: false after ensuring all phases produce the artifact.
      return generateReviewHandoff(cmd.info, { allowPartial: true }).pipe(
        Effect.catchTag("ReviewHandoffArtifactMissingError", (e) =>
          Effect.fail(new FsError({ message: e.message })),
        ),
        Effect.andThen(() =>
          setRunStatus(cmd.info.stateRoot, cmd.info.shortName, { state: "review_open" }),
        ),
      );
    case "WriteFinalReport":
      // No-op: final-report.md is written by generateReviewHandoff in OpenRunReview.
      // Phase-05 removes this effect from the domain.
      return Effect.void;
  }
}
