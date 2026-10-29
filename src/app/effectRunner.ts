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
import { toKeepAwakePlatform } from "../domain/whatsNext.js";
import {
  readPhaseStatusFile,
  readReviewStopFile,
  readRunStatusFile,
  withSchemaUrl,
} from "../schemas/persisted.js";
import { encodeReviewStopFile, type LastClose, type ReviewStop } from "../schemas/reviewStop.js";
import { encodePhaseStatus, encodeRunStatus } from "../schemas/status.js";
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
      const decoded = readRunStatusFile(path, parsed);
      if (Either.isRight(decoded)) {
        const updated = { ...decoded.right, ...cmd.patch.run, updatedAt: now };
        yield* fs.writeAtomic(
          path,
          JSON.stringify(encodeRunStatus(withSchemaUrl("run-status", updated)), null, 2),
        );
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
      const decoded = readPhaseStatusFile(path, parsed);
      if (Either.isRight(decoded)) {
        const updated = { ...decoded.right, ...cmd.patch.phase, updatedAt: now };
        yield* fs.writeAtomic(
          path,
          JSON.stringify(encodePhaseStatus(withSchemaUrl("phase-status", updated)), null, 2),
        );
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

// review-stop.json lives in the run folder while the run is awaiting_review;
// while a close runs it is parked in the stopped phase's folder.
const REVIEW_STOP_FILE = "review-stop.json";
const PARKED_REVIEW_STOP_FILE = "review-stop.closing.json";

function parkedReviewStopPath(ctx: EffectRunnerContext): Effect.Effect<string, FsError> {
  return ctx.phaseFolderPath === undefined
    ? Effect.fail(
        new FsError({
          message: `${join(ctx.runPath, REVIEW_STOP_FILE)}: no phase folder to park the review stop in`,
        }),
      )
    : Effect.succeed(join(ctx.phaseFolderPath, PARKED_REVIEW_STOP_FILE));
}

function writeReviewStop(
  ctx: EffectRunnerContext,
  reviewStop: ReviewStop,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.writeAtomic(
      join(ctx.runPath, REVIEW_STOP_FILE),
      JSON.stringify(encodeReviewStopFile(withSchemaUrl("review-stop", reviewStop)), null, 2),
    );
  });
}

// A close re-entered after a crash finds the document already parked.
function parkReviewStop(ctx: EffectRunnerContext): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const parked = yield* parkedReviewStopPath(ctx);
    const live = join(ctx.runPath, REVIEW_STOP_FILE);
    if (!(yield* fs.exists(live))) return;
    yield* fs.rename(live, parked);
  });
}

// Reads the parked copy, or the live one when the close never parked it, and
// writes it back to the run folder with `lastClose` set and every other field kept.
function restoreReviewStop(
  ctx: EffectRunnerContext,
  lastClose: LastClose,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const parked = yield* parkedReviewStopPath(ctx);
    const live = join(ctx.runPath, REVIEW_STOP_FILE);
    const source = (yield* fs.exists(parked)) ? parked : live;
    const raw = yield* fs.readText(source);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new FsError({ message: `${source}: not valid JSON` }),
    });
    const decoded = readReviewStopFile(source, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(new FsError({ message: decoded.left.message }));
    }
    yield* writeReviewStop(ctx, { ...decoded.right, lastClose });
    if (source === parked) yield* fs.remove(parked);
  });
}

// Without a phase folder (an archive), every phase folder is searched for a parked copy.
function discardReviewStop(ctx: EffectRunnerContext): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const parked =
      ctx.phaseFolderPath !== undefined
        ? [join(ctx.phaseFolderPath, PARKED_REVIEW_STOP_FILE)]
        : (yield* fs.list(ctx.runPath)).map((entry) =>
            join(ctx.runPath, entry, PARKED_REVIEW_STOP_FILE),
          );
    for (const path of [join(ctx.runPath, REVIEW_STOP_FILE), ...parked]) {
      if (yield* fs.exists(path)) yield* fs.remove(path);
    }
  });
}

// The stop's resume instructions name the worktree; a refused or interrupted
// close carries none, so it is read from the stopped phase's status.
function stoppedPhaseWorktree(
  ctx: EffectRunnerContext,
): Effect.Effect<string | undefined, never, FileSystem> {
  return Effect.gen(function* () {
    if (ctx.phaseFolderPath === undefined) return undefined;
    const fs = yield* FileSystem;
    const path = join(ctx.phaseFolderPath, "status.json");
    if (!(yield* fs.exists(path))) return undefined;
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    const decoded = readPhaseStatusFile(path, parsed);
    return Either.isRight(decoded) ? decoded.right.worktreePath : undefined;
  }).pipe(Effect.orElseSucceed(() => undefined));
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
    case "WriteResumeInstructions": {
      const platform = toKeepAwakePlatform(process.platform);
      return Effect.gen(function* () {
        const worktreePath =
          cmd.ctx.worktreePath === undefined && cmd.ctx.kind === "awaiting_review"
            ? yield* stoppedPhaseWorktree(ctx)
            : cmd.ctx.worktreePath;
        yield* writeResumeInstructions({
          runPath: ctx.runPath,
          shortName: ctx.shortName,
          reason: cmd.ctx.reason,
          kind: cmd.ctx.kind,
          resetAt: cmd.ctx.kind === "gates_exhausted" ? undefined : cmd.ctx.resetAt,
          phaseId: cmd.ctx.phaseId,
          worktreePath,
          sessionId: cmd.ctx.sessionId,
          rawMessage: cmd.ctx.kind === "gates_exhausted" ? undefined : cmd.ctx.rawMessage,
          refusal: cmd.ctx.refusal,
          failedStep: cmd.ctx.failedStep,
          protectedChanges: cmd.ctx.protectedChanges,
          lastFixTranscript: cmd.ctx.lastFixTranscript,
          now: new Date(),
          platform,
        });
      });
    }
    case "WriteReviewStop":
      return writeReviewStop(ctx, cmd.reviewStop);
    case "ParkReviewStop":
      return parkReviewStop(ctx);
    case "RestoreReviewStop":
      return restoreReviewStop(ctx, cmd.lastClose);
    case "DiscardReviewStop":
      return discardReviewStop(ctx);
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
      return generateReviewHandoff(cmd.info, { allowPartial: false }).pipe(
        Effect.catchTag("ReviewHandoffArtifactMissingError", (e) =>
          Effect.fail(new FsError({ message: e.message })),
        ),
        Effect.andThen(() =>
          setRunStatus(cmd.info.stateRoot, cmd.info.namespace, cmd.info.shortName, {
            state: "review_open",
          }),
        ),
      );
  }
}
