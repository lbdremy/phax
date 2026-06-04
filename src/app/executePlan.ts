import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BranchName, PhaseId, RunId, ShortName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName, decodePhaseId } from "../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  AgentInvocationError,
  AgentSessionIdMissingError,
  GateFailedError,
  PhaseHadNoChangesError,
  RateLimitError,
  RegistryCorruptionError,
  SecurityEnforcementError,
  SetupCommandFailedError,
  UnsafeGitStateError,
  UsageLimitError,
  WorktreeCreationError,
} from "../domain/errors.js";
import type { PhaxEvent, PhaxEventBase } from "../domain/events.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
  makeModelResolvedTelemetryEvent,
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { reportAgentFailure } from "./telemetry/reportBuilders.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import type { ModelRouting } from "../schemas/modelRouting.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import { DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG } from "../domain/routing/defaults.js";
import { resolveModel } from "../domain/routing/resolve.js";
import type { ProviderId, SecurityFilter } from "../domain/routing/types.js";
import { evaluateProviderSecurity } from "../domain/security/capabilities.js";
import { resolveSecurityPolicy } from "../domain/security/resolvePolicy.js";
import { cleanupPhase } from "./cleanup.js";
import { commitPhase } from "./commit.js";
import { reconcilePhaseFiles } from "./reconcilePhaseFiles.js";
import { dispatch, type DispatcherContext } from "./dispatcher.js";
import { recordGateProfileInRunStatus, resolveGateProfile } from "./gates.js";
import { runGatesWithFixLoop } from "./fixLoop.js";
import { generatePhaseHandoff, HandoffValidationError } from "./handoffGeneration.js";
import { readPreviousHandoff, readPreviousReconciliation } from "./handoffInjection.js";
import { createPhaseFolder } from "./phaseFolder.js";
import { recordPhaseWorktreeAndBranch } from "./phaseStatusUpdates.js";
import { buildPhasePrompt } from "./promptGeneration.js";
import { resolveRunByShortName } from "./resolveRunInfo.js";
import { setupPhase } from "./setup.js";
import { createPhaseWorktree, preparePhaseBranch, prepareRunBranch } from "./worktree.js";

function isRateLimitError(e: unknown): e is RateLimitError | UsageLimitError {
  return e instanceof RateLimitError || e instanceof UsageLimitError;
}

function isNoChangesError(e: unknown): e is PhaseHadNoChangesError {
  return e instanceof PhaseHadNoChangesError;
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
  readonly routing?: ModelRouting | undefined;
  readonly providerConfig?: ProviderConfig | undefined;
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
  | AgentInvocationError
  | AgentSessionIdMissingError
  | GateFailedError
  | HandoffValidationError
  | ArchiveBlockedByDirtyWorktreeError
  | RegistryCorruptionError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | PhaseHadNoChangesError;

export function executePlan(
  opts: ExecutePlanOptions,
): Effect.Effect<
  ExecutePlanResult,
  ExecutePlanError,
  Backend | FileSystem | Git | Shell | SystemTelemetry
> {
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
    routing = DEFAULT_MODEL_ROUTING,
    providerConfig = DEFAULT_PROVIDER_CONFIG,
  } = opts;

  // Tracked as the loop progresses so the rate-limit catch handler knows which
  // phase, worktree, and session were in flight when the limit was hit. These
  // values flow onto the RateLimitDetected event so the reducer can emit a
  // fully-populated WriteResumeInstructions command.
  let currentPhaseId: string | undefined;
  let currentPhaseFolderPath: string | undefined;
  let currentWorktreePath: string | undefined;
  let currentSessionId: string | undefined;

  function eventBase(phaseId?: string): PhaxEventBase {
    return {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: shortName as unknown as RunId,
      phase: phaseId as PhaseId | undefined,
    };
  }

  function dispatchCtx(phaseFolderPath?: string, phaseId?: string): DispatcherContext {
    return {
      runPath,
      shortName: shortName as string,
      phaseFolderPath,
      phaseId,
    };
  }

  const program = Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;

    yield* telemetry.recordEvent(makeStepStartedTelemetryEvent({ runId, step: "config.discover" }));
    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({ runId, step: "config.validate", result: "success" }),
    );

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
      yield* dispatch({ ...eventBase(), type: "RunStarted" }, dispatchCtx());
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

    // `previousPhaseBranch` tracks the ref each new phase branches off.
    // On a fresh run phase-01 branches off the run branch; phase-N branches off
    // phase-(N-1). On resume we seed it from the last completed phase so the
    // chain is correct without any extra disk read — the naming is total.
    let previousPhaseBranch: BranchName = branch;
    if (startIndex > 0) {
      const prevPhase = plan.phases[startIndex - 1];
      if (prevPhase !== undefined) {
        const prevBranchStr = `${plan.run.branch}--${prevPhase.id}`;
        const prevBranchResult = decodeBranchName(prevBranchStr);
        if (Either.isLeft(prevBranchResult)) {
          return yield* Effect.fail(
            new UnsafeGitStateError({
              message: `Invalid branch name "${prevBranchStr}": must be non-empty`,
              repoPath: config.repoRoot,
            }),
          );
        }
        previousPhaseBranch = prevBranchResult.right;
      }
    }

    // Lift a rate-limited run+phase back to running. On a fresh run the reducer
    // returns Ignored (run already running) and produces no writes; on resume
    // it transitions both the run and the in-flight phase to `running` so the
    // forward dispatches below treat the resumed phase as a normal new phase.
    const resumePhase = plan.phases[startIndex];
    const resumePhaseFolderPath = resumePhase ? join(runPath, resumePhase.id) : undefined;
    const resumePhaseId = resumePhase?.id;
    yield* dispatch(
      { ...eventBase(resumePhaseId), type: "RunResumeRequested" },
      dispatchCtx(resumePhaseFolderPath, resumePhaseId),
    );

    const setupCommands: readonly string[] = config.raw.commands?.setup ?? [];
    const cleanupCommands: readonly string[] = config.raw.commands?.cleanup ?? [];

    const committedPhases: string[] = [];
    let finalWorktreePath: WorktreePath | undefined;
    let finalPhaseId: string | undefined;

    for (let i = startIndex; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      if (phase === undefined) continue;
      const isFinal = i === plan.phases.length - 1;

      // Resolve the phase branch before creating the phase folder so the
      // initial status.json can include branchName (required by the schema).
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
      // Each phase gets its own branch (<run.branch>--<phaseId>) so multiple
      // worktrees can coexist — git refuses to check out one branch in two
      // worktrees simultaneously.
      const phaseBranch = yield* preparePhaseBranch(
        branch,
        phaseIdResult.right,
        previousPhaseBranch,
        config.repoRoot,
      );

      const phaseFolderPath = yield* createPhaseFolder(runPath, phase, i, phaseBranch);
      currentPhaseId = phase.id;
      currentPhaseFolderPath = phaseFolderPath;
      currentWorktreePath = undefined;
      currentSessionId = undefined;

      const ctx = dispatchCtx(phaseFolderPath, phase.id);

      // pending → setting_up_worktree (Ignored on a resumed phase already in
      // setting_up_worktree/running; Rejected if the phase is past pending in
      // an unexpected way).
      yield* dispatch(
        {
          ...eventBase(phase.id),
          type: "PhaseStartRequested",
          phaseId: phase.id as PhaseId,
        },
        ctx,
      );
      const worktreePath = yield* createPhaseWorktree(
        shortName,
        phaseIdResult.right,
        phaseBranch,
        config.stateRoot,
        config.repoRoot,
      );

      currentWorktreePath = worktreePath as string;
      yield* recordPhaseWorktreeAndBranch(phaseFolderPath, worktreePath, phaseBranch);
      yield* telemetry.recordEvent(
        makeAdapterCallSucceededTelemetryEvent({
          runId,
          operationId: phase.id,
          adapter: "git",
          operation: "worktree.create",
        }),
      );

      // setting_up_worktree → running (Ignored on a resumed phase already
      // running).
      yield* dispatch({ ...eventBase(phase.id), type: "WorktreeCreated", path: worktreePath }, ctx);

      yield* setupPhase({ worktreePath, phaseFolderPath, setupCommands });

      const previousHandoff = yield* readPreviousHandoff(runPath, plan.phases, i);
      const previousReconciliation = yield* readPreviousReconciliation(runPath, plan.phases, i);

      const promptGateCommands = config.raw.gateProfiles[gateProfileId]?.flat(1) ?? [];
      const promptText = buildPhasePrompt({
        planMd,
        planJson: plan,
        currentPhase: phase,
        previousHandoff,
        previousReconciliation,
        gateCommands: promptGateCommands,
      });

      const fs = yield* FileSystem;
      yield* fs.writeAtomic(join(phaseFolderPath, "prompt.md"), promptText);

      const securityMode = config.security.profile;
      const policyFor = (provider: ProviderId) =>
        resolveSecurityPolicy({
          mode: securityMode,
          provider,
          worktreePath: worktreePath as string,
          stateRoot: config.stateRoot,
          config: config.security,
        });
      const securityFilter: SecurityFilter = (provider) => {
        if (securityMode !== "secure") {
          return { allowed: true };
        }
        const evaluation = evaluateProviderSecurity(provider, policyFor(provider));
        return evaluation.satisfiesStrict
          ? { allowed: true }
          : {
              allowed: false,
              reason: evaluation.marks.length
                ? `cannot satisfy strict secure mode (${evaluation.marks.join(", ")})`
                : "cannot satisfy strict secure mode",
            };
      };

      const resolution = resolveModel(
        { model: phase.model, effort: phase.effort },
        routing,
        providerConfig,
        securityFilter,
      );

      const securityPolicy = resolveSecurityPolicy({
        mode: securityMode,
        provider: resolution.selected.provider,
        worktreePath: worktreePath as string,
        stateRoot: config.stateRoot,
        config: config.security,
      });

      yield* telemetry.recordEvent(
        makeModelResolvedTelemetryEvent({
          runId,
          operationId: phase.id,
          requestedFamily: resolution.requested.family,
          requestedEffort: resolution.requested.effort,
          normalizedTier: resolution.normalizedTier,
          selectedProvider: resolution.selected.provider,
          selectedFamily: resolution.selected.family,
          selectedConcreteModel: resolution.selected.concreteModel,
          ...(resolution.selected.thinking !== undefined
            ? { selectedThinking: resolution.selected.thinking }
            : {}),
          relationship: resolution.relationship,
          reason: resolution.reason,
        }),
      );

      yield* fs.writeAtomic(
        join(phaseFolderPath, "model-resolution.json"),
        JSON.stringify(resolution, null, 2),
      );

      const agentOptions: AgentRunOptions = {
        provider: resolution.selected.provider,
        model: resolution.selected.concreteModel,
        effort: resolution.selected.thinking ?? phase.effort,
        cwd: worktreePath as string,
        security: securityPolicy,
        outputJsonlPath: join(phaseFolderPath, "output.jsonl"),
        phaseFolderPath,
      };

      const backend = yield* Backend;
      const resolvedProvider = resolution.selected.provider;
      yield* telemetry.recordEvent(
        makeAdapterCallStartedTelemetryEvent({
          runId,
          operationId: phase.id,
          adapter: resolvedProvider,
          operation: "agent.run",
        }),
      );
      const agentResult = yield* telemetry.withOperation(
        `phax.${resolvedProvider}.agent.run`,
        { "phax.phase.id": phase.id },
        backend.runAgent(promptText, agentOptions).pipe(
          Effect.tapError((e) =>
            e instanceof AgentInvocationError
              ? telemetry.recordError(
                  reportAgentFailure(e, {
                    runId,
                    operationId: phase.id,
                    adapter: resolvedProvider,
                    operation: "agent.run",
                  }),
                )
              : Effect.void,
          ),
        ),
      );
      const sessionId = agentResult.sessionId;
      currentSessionId = sessionId as string;
      yield* telemetry.recordEvent(
        makeAdapterCallSucceededTelemetryEvent({
          runId,
          operationId: phase.id,
          adapter: resolvedProvider,
          operation: "agent.run",
        }),
      );
      yield* telemetry.recordEvent(
        makeArtifactGeneratedTelemetryEvent({
          runId,
          operationId: phase.id,
          artifact: "claude-session-id",
          path: sessionId as string,
        }),
      );

      // running → passed transition is dispatched inside fixLoop on the
      // gate-success branch via dispatch(GatePassed).
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

      yield* telemetry.recordEvent(
        makeStepStartedTelemetryEvent({ runId, operationId: phase.id, step: "handoff.generate" }),
      );
      yield* generatePhaseHandoff({
        sessionId,
        agentOptions,
        phaseFolderPath,
        worktreePath: worktreePath as string,
        runPath,
        shortName: shortName as string,
        phaseId: phase.id,
      });
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: phase.id,
          step: "handoff.generate",
          result: "success",
        }),
      );

      // commitPhase dispatches CommitCreated internally.
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
      yield* telemetry.recordEvent(
        makeAdapterCallSucceededTelemetryEvent({
          runId,
          operationId: phase.id,
          adapter: "git",
          operation: "commit.create",
        }),
      );

      yield* reconcilePhaseFiles({
        phase,
        worktreePath,
        phaseFolderPath,
        runId: runId as string,
        fileReconciliationMode: config.fileReconciliationMode,
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
        // running/{committed} → review_open. The reducer emits OpenRunReview
        // and WriteFinalReport effects; the runner writes review-handoff.md,
        // updates the registry, and writes final-report.md.
        yield* dispatch(
          {
            ...eventBase(phase.id),
            type: "FinalReviewOpened",
            info: infoResult.right,
          },
          ctx,
        );
      } else {
        // cleanupPhase dispatches CleanupStarted/CleanupCompleted internally.
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

      // Advance the chain: the next phase branches off this phase's branch.
      previousPhaseBranch = phaseBranch;
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
    // A rate/usage limit pauses the run instead of failing it: dispatch
    // RateLimitDetected so the reducer transitions run+phase to `rate_limited`,
    // writes resume-instructions.md, and emits the trace events. Then re-raise
    // so the CLI still sets a non-zero exit code. Worktree, logs, and session
    // id are deliberately preserved by the dispatcher (no cleanup effect).
    Effect.catchIf(isRateLimitError, (e) =>
      Effect.gen(function* () {
        const kind: "rate_limit" | "usage_limit" =
          e instanceof UsageLimitError ? "usage_limit" : "rate_limit";
        const rateLimitEvent: PhaxEvent = {
          ...eventBase(currentPhaseId),
          type: "RateLimitDetected",
          kind,
          resetAt: e.resetAt,
          cause: e,
          worktreePath: currentWorktreePath as WorktreePath | undefined,
          sessionId: currentSessionId as never,
        };
        yield* dispatch(rateLimitEvent, dispatchCtx(currentPhaseFolderPath, currentPhaseId));
        return yield* Effect.fail(e);
      }).pipe(Effect.catchAll(() => Effect.fail(e))),
    ),
    // A no-changes exit pauses the run instead of failing it: the event was
    // already dispatched inside commitPhase, so we just re-raise here to ensure
    // a non-zero exit code. The run is already in `interrupted` state.
    Effect.catchIf(isNoChangesError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    Effect.tapError((e) =>
      isRateLimitError(e) || isNoChangesError(e)
        ? Effect.void
        : dispatch(
            { ...eventBase(currentPhaseId), type: "RunFailed", cause: e },
            dispatchCtx(currentPhaseFolderPath, currentPhaseId),
          ).pipe(Effect.catchAll(() => Effect.void)),
    ),
  );
}
