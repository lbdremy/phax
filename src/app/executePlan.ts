import { Effect, Either } from "effect";
import { join } from "node:path";
import type { RunId, ShortName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName, decodePhaseId } from "../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  GateFailedError,
  RateLimitError,
  RegistryCorruptionError,
  SetupCommandFailedError,
  UnsafeGitStateError,
  UsageLimitError,
  WorktreeCreationError,
} from "../domain/errors.js";
import {
  failRun,
  pendingToSettingUp,
  rateLimitPhase,
  rateLimitRun,
  rateLimitedToRunning,
  resumeRateLimitedRun,
  runningToPassed,
  settingUpToRunning,
  startRun,
} from "../domain/state.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { Tracer, type TraceEventName, type TraceStatus } from "../ports/tracer.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import {
  decodePhaseStatus,
  decodeRunStatus,
  encodePhaseStatus,
  encodeRunStatus,
  type PhaseStatus,
  type RunStatus,
} from "../schemas/status.js";
import { cleanupPhase } from "./cleanup.js";
import { commitPhase } from "./commit.js";
import { writeFinalReport } from "./finalReport.js";
import { openFinalReview } from "./finalReview.js";
import { recordGateProfileInRunStatus, resolveGateProfile } from "./gates.js";
import { runGatesWithFixLoop } from "./fixLoop.js";
import { generatePhaseHandoff, HandoffValidationError } from "./handoffGeneration.js";
import { readPreviousHandoff } from "./handoffInjection.js";
import { createPhaseFolder } from "./phaseFolder.js";
import { recordPhaseWorktreePath } from "./phaseStatusUpdates.js";
import { buildPhasePrompt } from "./promptGeneration.js";
import { resolveRunByShortName } from "./resolveRunInfo.js";
import { setupPhase } from "./setup.js";
import { writeResumeInstructions } from "./resumeInstructions.js";
import { createPhaseWorktree, prepareRunBranch } from "./worktree.js";

function patchPhaseStatus(
  phaseFolderPath: string,
  patch: (s: PhaseStatus) => PhaseStatus,
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
      const updated = patch(decoded.right);
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
}

function patchRunStatus(
  runPath: string,
  patch: (s: RunStatus) => RunStatus,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(runPath, "run-status.json");
    const raw = yield* fs.readText(statusPath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    const decoded = decodeRunStatus(parsed);
    if (Either.isRight(decoded)) {
      const updated = patch(decoded.right);
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodeRunStatus(updated), null, 2));
    }
  });
}

function transitionRunRunning(runPath: string): Effect.Effect<void, FsError, FileSystem> {
  return patchRunStatus(runPath, (s) => {
    const next = startRun(s.state);
    if (Either.isLeft(next)) return s;
    return { ...s, state: next.right, updatedAt: new Date().toISOString() };
  });
}

function transitionRunFailedIfRunning(runPath: string): Effect.Effect<void, FsError, FileSystem> {
  return patchRunStatus(runPath, (s) => {
    const next = failRun(s.state);
    if (Either.isLeft(next)) return s;
    return { ...s, state: next.right, updatedAt: new Date().toISOString() };
  });
}

function transitionPhasePendingToSettingUp(
  phaseFolderPath: string,
): Effect.Effect<void, FsError, FileSystem> {
  return patchPhaseStatus(phaseFolderPath, (s) => {
    const next = pendingToSettingUp(s.state);
    if (Either.isLeft(next)) return s;
    return { ...s, state: next.right, updatedAt: new Date().toISOString() };
  });
}

function transitionPhaseSettingUpToRunning(
  phaseFolderPath: string,
): Effect.Effect<void, FsError, FileSystem> {
  return patchPhaseStatus(phaseFolderPath, (s) => {
    const next = settingUpToRunning(s.state);
    if (Either.isLeft(next)) return s;
    return { ...s, state: next.right, updatedAt: new Date().toISOString() };
  });
}

function transitionPhaseRunningToPassed(
  phaseFolderPath: string,
): Effect.Effect<void, FsError, FileSystem> {
  return patchPhaseStatus(phaseFolderPath, (s) => {
    const next = runningToPassed(s.state);
    if (Either.isLeft(next)) return s;
    return { ...s, state: next.right, updatedAt: new Date().toISOString() };
  });
}

/** Resume entry point: bring a `rate_limited` run back to `running` (no-op otherwise). */
function transitionRunResumeRateLimited(runPath: string): Effect.Effect<void, FsError, FileSystem> {
  return patchRunStatus(runPath, (s) => {
    const next = resumeRateLimitedRun(s.state);
    if (Either.isLeft(next)) return s;
    return { ...s, state: next.right, updatedAt: new Date().toISOString() };
  });
}

/** Resume entry point: bring a `rate_limited` phase back to `running` (no-op otherwise). */
function transitionPhaseResumeRateLimited(
  phaseFolderPath: string,
): Effect.Effect<void, FsError, FileSystem> {
  return patchPhaseStatus(phaseFolderPath, (s) => {
    const next = rateLimitedToRunning(s.state);
    if (Either.isLeft(next)) return s;
    return { ...s, state: next.right, updatedAt: new Date().toISOString() };
  });
}

function isRateLimitError(e: unknown): e is RateLimitError | UsageLimitError {
  return e instanceof RateLimitError || e instanceof UsageLimitError;
}

interface RateLimitStopContext {
  readonly error: RateLimitError | UsageLimitError;
  readonly runPath: string;
  readonly shortName: string;
  readonly phaseId: string | undefined;
  readonly phaseFolderPath: string | undefined;
  readonly worktreePath: string | undefined;
  readonly sessionId: string | undefined;
}

/**
 * Pause a run on a rate/usage limit (spec §9): transition the run and the
 * in-flight phase to `rate_limited`, write `resume-instructions.md`, and emit
 * the trace events. Worktree, logs and session id are deliberately left in
 * place so the run can resume. This never fails — the original limit error is
 * re-raised by the caller so the CLI still sets a non-zero exit code.
 */
function handleRateLimitStop(
  ctx: RateLimitStopContext,
): Effect.Effect<void, never, FileSystem | Tracer> {
  return Effect.gen(function* () {
    const tracer = yield* Tracer;
    const isUsage = ctx.error instanceof UsageLimitError;
    const reason = isUsage ? "Usage limit" : "Rate limit";

    yield* patchRunStatus(ctx.runPath, (s) => {
      const next = rateLimitRun(s.state);
      if (Either.isLeft(next)) return s;
      return {
        ...s,
        state: next.right,
        stoppedReason: "rate_limited",
        lastError: ctx.error.message,
        updatedAt: new Date().toISOString(),
      };
    });

    if (ctx.phaseFolderPath !== undefined) {
      yield* patchPhaseStatus(ctx.phaseFolderPath, (s) => {
        const next = rateLimitPhase(s.state);
        if (Either.isLeft(next)) return s;
        return { ...s, state: next.right, updatedAt: new Date().toISOString() };
      });
    }

    yield* writeResumeInstructions({
      runPath: ctx.runPath,
      shortName: ctx.shortName,
      reason,
      resetAt: ctx.error.resetAt,
      phaseId: ctx.phaseId,
      worktreePath: ctx.worktreePath,
      sessionId: ctx.sessionId,
      rawMessage: ctx.error.rawMessage,
    });

    const baseEvent = {
      run: ctx.shortName,
      phase: ctx.phaseId,
      timestamp: new Date().toISOString(),
    };
    yield* tracer.event({
      ...baseEvent,
      event: "rate_limit.detected",
      boundary: "claude-code",
      status: "failed",
      details: { kind: isUsage ? "usage_limit" : "rate_limit", resetAt: ctx.error.resetAt },
    });
    yield* tracer.event({
      ...baseEvent,
      event: "resume.available",
      boundary: "resume-instructions.md",
      status: "info",
      details: { resumeCommand: `phax resume ${ctx.shortName}` },
    });
  }).pipe(Effect.catchAll(() => Effect.void));
}

export interface ExecutePlanOptions {
  readonly shortName: ShortName;
  readonly plan: PhaxPlan;
  readonly planMd: string;
  readonly config: ResolvedConfig;
  readonly gateProfileId: string;
  readonly workspaceId?: string | undefined;
  readonly allowDirty: boolean;
  readonly runPath: string;
  readonly runId: RunId;
  readonly startIndex: number;
}

export interface ExecutePlanResult {
  readonly committedPhases: readonly string[];
  readonly finalPhaseId: string;
  readonly finalWorktreePath: WorktreePath;
}

export type ExecutePlanError =
  | FsError
  | ShellError
  | GitError
  | UnsafeGitStateError
  | WorktreeCreationError
  | SetupCommandFailedError
  | ClaudeInvocationError
  | ClaudeSessionIdMissingError
  | GateFailedError
  | HandoffValidationError
  | ArchiveBlockedByDirtyWorktreeError
  | RegistryCorruptionError
  | RateLimitError
  | UsageLimitError;

export function executePlan(
  opts: ExecutePlanOptions,
): Effect.Effect<ExecutePlanResult, ExecutePlanError, Backend | FileSystem | Git | Shell | Tracer> {
  const {
    shortName,
    plan,
    planMd,
    config,
    gateProfileId,
    workspaceId,
    allowDirty,
    runPath,
    runId,
    startIndex,
  } = opts;

  // Tracked as the loop progresses so a rate-limit stop knows which phase,
  // worktree and session were in flight when the limit was hit.
  let currentPhaseId: string | undefined;
  let currentPhaseFolderPath: string | undefined;
  let currentWorktreePath: string | undefined;
  let currentSessionId: string | undefined;

  const program = Effect.gen(function* () {
    const tracer = yield* Tracer;
    const emit = (
      event: TraceEventName,
      status: TraceStatus,
      extra?: {
        phase?: string | undefined;
        boundary?: string | undefined;
        details?: Record<string, unknown> | undefined;
      },
    ): Effect.Effect<void, never, never> =>
      tracer.event({
        timestamp: new Date().toISOString(),
        run: shortName as string,
        phase: extra?.phase,
        event,
        boundary: extra?.boundary,
        status,
        details: extra?.details,
      });

    yield* emit("config.discovered", "info", { boundary: "phax.json" });
    yield* emit("config.validated", "ok", {
      boundary: "phax.json",
      details: { gateProfileId, repoRoot: config.repoRoot, workspaceId },
    });

    let gateCommands: readonly string[];
    try {
      gateCommands = resolveGateProfile(config, gateProfileId, workspaceId);
    } catch (err) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: err instanceof Error ? err.message : String(err),
          repoPath: config.repoRoot,
        }),
      );
    }

    let branch;
    if (startIndex === 0) {
      branch = yield* prepareRunBranch(shortName, plan.run.branch, config.repoRoot, allowDirty);
      yield* transitionRunRunning(runPath);
      yield* emit("state.transition", "ok", { details: { entity: "run", to: "running" } });
      yield* recordGateProfileInRunStatus(runPath, gateProfileId);
    } else {
      const branchResult = decodeBranchName(plan.run.branch);
      if (Either.isLeft(branchResult)) {
        return yield* Effect.fail(
          new UnsafeGitStateError({
            message: `Invalid branch name "${plan.run.branch}": must be non-empty`,
            repoPath: config.repoRoot,
          }),
        );
      }
      branch = branchResult.right;
    }

    // Resuming a rate-limited run: bring it back to `running`. No-op for a
    // fresh run (already `running`) — works whether resume restarts at the
    // first phase (startIndex 0) or a later one.
    yield* transitionRunResumeRateLimited(runPath);

    const setupCommands: readonly string[] = config.raw.commands?.setup ?? [];
    const cleanupCommands: readonly string[] = config.raw.commands?.cleanup ?? [];

    const committedPhases: string[] = [];
    let finalWorktreePath: WorktreePath | undefined;
    let finalPhaseId: string | undefined;

    for (let i = startIndex; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      if (phase === undefined) continue;
      const isFinal = i === plan.phases.length - 1;

      const phaseFolderPath = yield* createPhaseFolder(runPath, phase, i);
      currentPhaseId = phase.id;
      currentPhaseFolderPath = phaseFolderPath;
      currentWorktreePath = undefined;
      currentSessionId = undefined;

      // Resuming a rate-limited phase: bring it back to `running` so the
      // forward transitions below apply (no-op for a fresh `pending` phase).
      yield* transitionPhaseResumeRateLimited(phaseFolderPath);

      yield* transitionPhasePendingToSettingUp(phaseFolderPath);
      yield* emit("state.transition", "ok", {
        phase: phase.id,
        details: { entity: "phase", to: "setting_up_worktree" },
      });

      const phaseIdResult = decodePhaseId(phase.id);
      if (Either.isLeft(phaseIdResult)) {
        return yield* Effect.fail(
          new WorktreeCreationError({
            message: `Invalid phase id "${phase.id}": must match phase-NN`,
            branch,
            path: "",
          }),
        );
      }
      const worktreePath = yield* createPhaseWorktree(
        shortName,
        phaseIdResult.right,
        branch,
        config.stateRoot,
        config.repoRoot,
      );

      currentWorktreePath = worktreePath as string;
      yield* recordPhaseWorktreePath(phaseFolderPath, worktreePath);
      yield* emit("git.worktree.created", "ok", {
        phase: phase.id,
        boundary: "worktree",
        details: { worktreePath: worktreePath as string },
      });

      yield* transitionPhaseSettingUpToRunning(phaseFolderPath);
      yield* emit("state.transition", "ok", {
        phase: phase.id,
        details: { entity: "phase", to: "running" },
      });

      yield* setupPhase({ worktreePath, phaseFolderPath, setupCommands });

      const previousHandoff = yield* readPreviousHandoff(runPath, plan.phases, i);

      const promptText = buildPhasePrompt({
        planMd,
        planJson: plan,
        currentPhase: phase,
        previousHandoff,
      });

      const fs = yield* FileSystem;
      yield* fs.writeAtomic(join(phaseFolderPath, "prompt.md"), promptText);

      const agentOptions: AgentRunOptions = {
        model: phase.model,
        effort: phase.effort,
        cwd: worktreePath as string,
        outputJsonlPath: join(phaseFolderPath, "output.jsonl"),
        phaseFolderPath,
      };

      const backend = yield* Backend;
      yield* emit("agent.invocation.started", "info", {
        phase: phase.id,
        boundary: "claude-code",
        details: { model: phase.model, effort: phase.effort },
      });
      const agentResult = yield* backend.runAgent(promptText, agentOptions);
      const sessionId = agentResult.sessionId;
      currentSessionId = sessionId as string;
      yield* emit("agent.invocation.completed", "ok", {
        phase: phase.id,
        boundary: "claude-code",
      });
      yield* emit("agent.session.captured", "ok", {
        phase: phase.id,
        details: { sessionId: sessionId as string },
      });

      yield* runGatesWithFixLoop({
        commands: gateCommands,
        cwd: worktreePath as string,
        phaseFolderPath,
        sessionId,
        agentOptions,
        maxFixAttempts: config.maxFixAttempts,
        run: shortName as string,
        phaseId: phase.id,
        runPath,
      });

      yield* transitionPhaseRunningToPassed(phaseFolderPath);
      yield* emit("state.transition", "ok", {
        phase: phase.id,
        details: { entity: "phase", to: "passed" },
      });

      yield* emit("handoff.requested", "info", {
        phase: phase.id,
        boundary: "phase-handoff.md",
      });
      yield* generatePhaseHandoff({
        sessionId,
        agentOptions,
        phaseFolderPath,
        worktreePath: worktreePath as string,
        runPath,
        shortName: shortName as string,
        phaseId: phase.id,
      });
      yield* emit("handoff.validated", "ok", {
        phase: phase.id,
        boundary: "phase-handoff.md",
      });

      yield* commitPhase({
        phase,
        worktreePath,
        phaseFolderPath,
        runId: runId as string,
        shortName: shortName as string,
        sessionId,
        gateLogPath: join(phaseFolderPath, "checks-attempt-01.log"),
        repoRoot: config.repoRoot,
        runPath,
      });

      committedPhases.push(phase.id);
      yield* emit("git.commit.created", "ok", {
        phase: phase.id,
        boundary: "git",
        details: { subject: phase.commit.subject },
      });

      if (isFinal) {
        finalWorktreePath = worktreePath;
        finalPhaseId = phase.id;

        const infoResult = resolveRunByShortName(shortName, config.stateRoot);
        if (Either.isLeft(infoResult)) {
          return yield* Effect.fail(
            new RegistryCorruptionError({
              message: `Failed to resolve run "${shortName}" for final review: ${infoResult.left}`,
              registryPath: join(config.stateRoot, "registry.json"),
            }),
          );
        }
        yield* openFinalReview(infoResult.right);
        yield* writeFinalReport(infoResult.right);
      } else {
        yield* cleanupPhase({
          worktreePath,
          phaseFolderPath,
          cleanupCommands,
          repoRoot: config.repoRoot,
          isFinalPhase: false,
          runPath,
          shortName: shortName as string,
          phaseId: phase.id,
        });
      }
    }

    if (finalWorktreePath === undefined || finalPhaseId === undefined) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: "executePlan completed without processing any phase",
          repoPath: config.repoRoot,
        }),
      );
    }

    return {
      committedPhases,
      finalPhaseId,
      finalWorktreePath,
    };
  });

  return program.pipe(
    // A rate/usage limit pauses the run instead of failing it: transition to
    // `rate_limited`, write resume-instructions.md, then re-raise so the CLI
    // still exits non-zero. Cleanup is skipped — the worktree must survive.
    Effect.catchIf(isRateLimitError, (e) =>
      handleRateLimitStop({
        error: e,
        runPath,
        shortName: shortName as string,
        phaseId: currentPhaseId,
        phaseFolderPath: currentPhaseFolderPath,
        worktreePath: currentWorktreePath,
        sessionId: currentSessionId,
      }).pipe(Effect.flatMap(() => Effect.fail(e))),
    ),
    Effect.tapError((e) =>
      isRateLimitError(e)
        ? Effect.void
        : transitionRunFailedIfRunning(runPath).pipe(Effect.catchAll(() => Effect.void)),
    ),
  );
}
