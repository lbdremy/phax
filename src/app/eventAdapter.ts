import { Effect } from "effect";
import type { BranchName, ClaudeSessionId, WorktreePath } from "../domain/branded.js";
import type {
  AgentInvocationCompleted,
  CleanupCompleted,
  CommitCreated,
  GateFailed,
  GatePassed,
  HandoffMissing,
  HandoffValidated,
  PhaxEvent,
  PhaxEventBase,
  RateLimitDetected,
  WorktreeCreated,
} from "../domain/events.js";
import type {
  ArchiveBlockedByDirtyWorktreeError,
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  RegistryCorruptionError,
} from "../domain/errors.js";
import { SetupCommandFailedError } from "../domain/errors.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { Tracer } from "../ports/tracer.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { reportGitFailure } from "./telemetry/reportBuilders.js";
import { cleanupPhase, type CleanupPhaseOptions } from "./cleanup.js";
import { commitPhase, type CommitPhaseOptions } from "./commit.js";
import { runGates } from "./gates.js";
import {
  generatePhaseHandoff,
  HandoffValidationError,
  type GenerateHandoffOptions,
} from "./handoffGeneration.js";

/**
 * Wraps an Effect so both the success and failure paths produce a PhaxEvent.
 * When `fail` returns null, the original error re-propagates unchanged.
 */
export function eventify<A, E, R>(
  eff: Effect.Effect<A, E, R>,
  ok: (a: A) => PhaxEvent,
  fail: (e: E) => PhaxEvent | null,
): Effect.Effect<PhaxEvent, E, R> {
  return eff.pipe(
    Effect.map(ok),
    Effect.catchAll((e) => {
      const event = fail(e);
      return event !== null ? Effect.succeed(event) : Effect.fail(e);
    }),
  );
}

export function adaptAgentRun(
  prompt: string,
  options: AgentRunOptions,
  base: PhaxEventBase,
): Effect.Effect<
  AgentInvocationCompleted | RateLimitDetected,
  ClaudeInvocationError | FsError,
  Backend
> {
  return Backend.pipe(
    Effect.flatMap((backend) =>
      backend.runAgent(prompt, options).pipe(
        Effect.map(
          (result): AgentInvocationCompleted => ({
            ...base,
            type: "AgentInvocationCompleted",
            sessionId: result.sessionId,
          }),
        ),
        Effect.catchTag(
          "RateLimitError",
          (e): Effect.Effect<RateLimitDetected, never> =>
            Effect.succeed({
              ...base,
              type: "RateLimitDetected",
              kind: "rate_limit",
              resetAt: e.resetAt,
              cause: e,
            }),
        ),
        Effect.catchTag(
          "UsageLimitError",
          (e): Effect.Effect<RateLimitDetected, never> =>
            Effect.succeed({
              ...base,
              type: "RateLimitDetected",
              kind: "usage_limit",
              resetAt: e.resetAt,
              cause: e,
            }),
        ),
      ),
    ),
  );
}

export function adaptAgentResume(
  sessionId: ClaudeSessionId,
  prompt: string,
  options: AgentRunOptions,
  base: PhaxEventBase,
): Effect.Effect<
  AgentInvocationCompleted | RateLimitDetected,
  ClaudeInvocationError | ClaudeSessionIdMissingError | FsError,
  Backend
> {
  return Backend.pipe(
    Effect.flatMap((backend) =>
      backend.resumeAgentSession(sessionId, prompt, options).pipe(
        Effect.map(
          (result): AgentInvocationCompleted => ({
            ...base,
            type: "AgentInvocationCompleted",
            sessionId: result.sessionId,
          }),
        ),
        Effect.catchTag(
          "RateLimitError",
          (e): Effect.Effect<RateLimitDetected, never> =>
            Effect.succeed({
              ...base,
              type: "RateLimitDetected",
              kind: "rate_limit",
              resetAt: e.resetAt,
              cause: e,
            }),
        ),
        Effect.catchTag(
          "UsageLimitError",
          (e): Effect.Effect<RateLimitDetected, never> =>
            Effect.succeed({
              ...base,
              type: "RateLimitDetected",
              kind: "usage_limit",
              resetAt: e.resetAt,
              cause: e,
            }),
        ),
      ),
    ),
  );
}

export function adaptGateRun(
  commands: readonly string[],
  cwd: string,
  attemptLogPath: string,
  attempt: number,
  base: PhaxEventBase,
): Effect.Effect<GatePassed | GateFailed, FsError | ShellError, Shell | FileSystem> {
  return runGates(commands, cwd, attemptLogPath).pipe(
    Effect.map((): GatePassed => ({ ...base, type: "GatePassed", attempt })),
    Effect.catchTag(
      "GateFailedError",
      (e): Effect.Effect<GateFailed, never> =>
        Effect.succeed({
          ...base,
          type: "GateFailed",
          command: e.command,
          exitCode: e.exitCode,
          logPath: e.logPath,
          attempt,
        }),
    ),
  );
}

export function adaptCommit(
  opts: CommitPhaseOptions,
  base: PhaxEventBase,
): Effect.Effect<
  CommitCreated | null,
  GitError | ShellError | FsError | SetupCommandFailedError | RegistryCorruptionError,
  Git | Shell | FileSystem | Tracer | SystemTelemetry
> {
  return commitPhase(opts).pipe(
    Effect.map((result): CommitCreated | null => {
      if (!result.committed || result.commitHash === undefined) {
        return null;
      }
      return { ...base, type: "CommitCreated", hash: result.commitHash };
    }),
  );
}

export function adaptCleanup(
  opts: CleanupPhaseOptions,
  base: PhaxEventBase,
): Effect.Effect<
  CleanupCompleted | null,
  | SetupCommandFailedError
  | ArchiveBlockedByDirtyWorktreeError
  | GitError
  | ShellError
  | FsError
  | RegistryCorruptionError,
  Git | Shell | FileSystem | Tracer | SystemTelemetry
> {
  if (opts.isFinalPhase) {
    return Effect.succeed(null);
  }
  return cleanupPhase(opts).pipe(
    Effect.map((): CleanupCompleted => ({ ...base, type: "CleanupCompleted" })),
  );
}

export function adaptHandoffGenerate(
  opts: GenerateHandoffOptions,
  base: PhaxEventBase,
): Effect.Effect<
  HandoffValidated | HandoffMissing | RateLimitDetected,
  | ClaudeInvocationError
  | ClaudeSessionIdMissingError
  | GitError
  | ShellError
  | FsError
  | SetupCommandFailedError,
  FileSystem | Backend | Git | Shell | Tracer | SystemTelemetry
> {
  return generatePhaseHandoff(opts).pipe(
    Effect.map((): HandoffValidated => ({ ...base, type: "HandoffValidated" })),
    Effect.catchTag(
      "RateLimitError",
      (e): Effect.Effect<RateLimitDetected, never> =>
        Effect.succeed({
          ...base,
          type: "RateLimitDetected",
          kind: "rate_limit",
          resetAt: e.resetAt,
          cause: e,
        }),
    ),
    Effect.catchTag(
      "UsageLimitError",
      (e): Effect.Effect<RateLimitDetected, never> =>
        Effect.succeed({
          ...base,
          type: "RateLimitDetected",
          kind: "usage_limit",
          resetAt: e.resetAt,
          cause: e,
        }),
    ),
    Effect.catchAll(
      (
        e,
      ): Effect.Effect<
        HandoffMissing,
        | ClaudeInvocationError
        | ClaudeSessionIdMissingError
        | GitError
        | ShellError
        | FsError
        | SetupCommandFailedError
      > => {
        if (e instanceof HandoffValidationError) {
          return Effect.succeed({
            ...base,
            type: "HandoffMissing",
            missingSections: e.missingSections,
          });
        }
        return Effect.fail(
          e as
            | ClaudeInvocationError
            | ClaudeSessionIdMissingError
            | GitError
            | ShellError
            | FsError
            | SetupCommandFailedError,
        );
      },
    ),
  );
}

export function adaptWorktreeCreate(
  branch: BranchName,
  path: WorktreePath,
  repoRoot: string,
  base: PhaxEventBase,
): Effect.Effect<WorktreeCreated, GitError, Git | SystemTelemetry> {
  return Git.pipe(
    Effect.flatMap((git) =>
      git.addWorktree(branch, path, repoRoot).pipe(
        Effect.map((): WorktreeCreated => ({ ...base, type: "WorktreeCreated", path })),
        Effect.tapError((e: GitError) =>
          SystemTelemetry.pipe(
            Effect.flatMap((telemetry) =>
              telemetry.recordError(
                reportGitFailure(e, {
                  runId: base.run,
                  ...(base.phase !== undefined ? { operationId: base.phase as string } : {}),
                  adapter: "git",
                  operation: "worktree.create",
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
