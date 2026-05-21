import { Effect, Either } from "effect";
import { join } from "node:path";
import type { WorktreePath } from "../domain/branded.js";
import type { PhaxCommand } from "../domain/effects.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { Tracer } from "../ports/tracer.js";
import {
  decodePhaseStatus,
  decodeRunStatus,
  encodePhaseStatus,
  encodeRunStatus,
} from "../schemas/status.js";
import { writeResumeInstructions } from "./resumeInstructions.js";

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

function parseCommandTokens(raw: string): readonly [string, ...string[]] | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (parts.length === 0 || first === undefined) return null;
  return [first, ...parts.slice(1)];
}

function runCleanupShell(
  cmd: Extract<PhaxCommand, { type: "RunCleanupShell" }>,
): Effect.Effect<void, ShellError, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    for (const raw of cmd.commands) {
      const tokens = parseCommandTokens(raw);
      if (tokens === null) continue;
      yield* shell.run({ command: tokens, cwd: cmd.cwd });
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
): Effect.Effect<void, FsError | ShellError | GitError, FileSystem | Git | Shell | Tracer> {
  switch (cmd.type) {
    case "PersistState":
      return persistState(ctx, cmd);
    case "EmitTrace":
      return Effect.gen(function* () {
        const tracer = yield* Tracer;
        yield* tracer.event({
          timestamp: new Date().toISOString(),
          run: ctx.shortName,
          phase: ctx.phaseId,
          event: cmd.name,
          status: cmd.status,
          details: cmd.details,
        });
      });
    case "WriteResumeInstructions":
      return writeResumeInstructions({
        runPath: cmd.ctx.runDir,
        shortName: ctx.shortName,
        reason: "Rate limit",
        resetAt: cmd.ctx.resetAt,
      }).pipe(Effect.asVoid);
    case "RemoveWorktree":
      return Effect.gen(function* () {
        const git = yield* Git;
        yield* git.removeWorktree(cmd.path as WorktreePath, cmd.force, ctx.runPath);
      });
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
        yield* fs.rename(cmd.from, cmd.to);
      });
    case "OpenRunReview":
    case "WriteFinalReport":
      // Phase-05/06 will wire these. They need richer info than the trimmed
      // RunReviewInfo carried on the command; the dispatcher does not emit
      // them yet, so reaching this branch in phase-03 is a programmer error.
      return Effect.dieMessage(`${cmd.type} effect not yet implemented`);
  }
}
