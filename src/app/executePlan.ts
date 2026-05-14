import { Effect, Either } from "effect";
import { join } from "node:path";
import type { RunId, ShortName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName, decodePhaseId } from "../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  GateFailedError,
  RegistryCorruptionError,
  SetupCommandFailedError,
  UnsafeGitStateError,
  WorktreeCreationError,
} from "../domain/errors.js";
import {
  failRun,
  pendingToSettingUp,
  runningToPassed,
  settingUpToRunning,
  startRun,
} from "../domain/state.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
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
  | RegistryCorruptionError;

export function executePlan(
  opts: ExecutePlanOptions,
): Effect.Effect<ExecutePlanResult, ExecutePlanError, Backend | FileSystem | Git | Shell> {
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

  const program = Effect.gen(function* () {
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

      yield* transitionPhasePendingToSettingUp(phaseFolderPath);

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

      yield* recordPhaseWorktreePath(phaseFolderPath, worktreePath);

      yield* transitionPhaseSettingUpToRunning(phaseFolderPath);

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
      const agentResult = yield* backend.runAgent(promptText, agentOptions);
      const sessionId = agentResult.sessionId;

      yield* runGatesWithFixLoop({
        commands: gateCommands,
        cwd: worktreePath as string,
        phaseFolderPath,
        sessionId,
        agentOptions,
        maxFixAttempts: config.maxFixAttempts,
      });

      yield* transitionPhaseRunningToPassed(phaseFolderPath);

      yield* generatePhaseHandoff({
        sessionId,
        agentOptions,
        phaseFolderPath,
        worktreePath: worktreePath as string,
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
      });

      committedPhases.push(phase.id);

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
    Effect.tapError(() =>
      transitionRunFailedIfRunning(runPath).pipe(Effect.catchAll(() => Effect.void)),
    ),
  );
}
