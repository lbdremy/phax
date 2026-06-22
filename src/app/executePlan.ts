import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  BranchName,
  ClaudeSessionId,
  PhaseId,
  RunId,
  ShortName,
  WorktreePath,
} from "../domain/branded.js";
import { decodeBranchName, decodePhaseId, decodeWorktreePath } from "../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  AgentInvocationError,
  AgentSessionIdMissingError,
  GateAttemptsExhaustedError,
  GateFailedError,
  PhaseHadNoChangesError,
  RateLimitError,
  RegistryCorruptionError,
  SecurityEnforcementError,
  SecurityPreflightError,
  SetupCommandFailedError,
  UnsafeGitStateError,
  UsageLimitError,
  WorktreeCreationError,
} from "../domain/errors.js";
import type { PhaxEvent, PhaxEventBase } from "../domain/events.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { GitHub } from "../ports/github.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { publishRun } from "./publishRun.js";
import { reviewCompliance } from "./reviewCompliance.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
  makeModelResolvedTelemetryEvent,
  makeSecurityPolicyAppliedTelemetryEvent,
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { reportAgentFailure } from "./telemetry/reportBuilders.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { encodeSecurityPosture, type SecurityPosture } from "../schemas/securityPosture.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import type { ModelRouting } from "../schemas/modelRouting.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import { DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG } from "../domain/routing/defaults.js";
import { resolveModel } from "../domain/routing/resolve.js";
import type { SecurityFilter } from "../domain/routing/types.js";
import type { SecurityMode } from "../domain/security/types.js";
import { evaluateProviderSecurity } from "../domain/security/capabilities.js";
import {
  checkRequiredCommands,
  computeFrozenAgentCommands,
} from "../domain/security/agentCommands.js";
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
import {
  writeAgentBinding,
  patchAgentBindingSession,
  patchAgentBindingStatus,
  readAgentBinding,
} from "./agentBinding.js";
import { providerToAdapter } from "../domain/providerAdapter.js";

function isRateLimitError(e: unknown): e is RateLimitError | UsageLimitError {
  return e instanceof RateLimitError || e instanceof UsageLimitError;
}

function isNoChangesError(e: unknown): e is PhaseHadNoChangesError {
  return e instanceof PhaseHadNoChangesError;
}

function isGateAttemptsExhaustedError(e: unknown): e is GateAttemptsExhaustedError {
  return e instanceof GateAttemptsExhaustedError;
}

// Highest NN suffix on `checks-attempt-NN.log` in the phase folder, or 0 if none.
// On resume from gate exhaustion we use this to continue numbering attempt
// artifacts, so prior `checks-attempt-NN.log` / `fix-attempt-NN.jsonl` files are
// never clobbered.
function maxAttemptIndexInPhaseFolder(phaseFolderPath: string): number {
  let entries: string[];
  try {
    entries = readdirSync(phaseFolderPath);
  } catch {
    return 0;
  }
  let max = 0;
  for (const entry of entries) {
    const match = /^checks-attempt-(\d{2})\.log$/.exec(entry);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
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
  readonly securityMode?: SecurityMode | undefined;
  readonly verbose?: boolean | undefined;
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
  | GateAttemptsExhaustedError
  | HandoffValidationError
  | ArchiveBlockedByDirtyWorktreeError
  | RegistryCorruptionError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | SecurityPreflightError
  | PhaseHadNoChangesError;

export function executePlan(
  opts: ExecutePlanOptions,
): Effect.Effect<
  ExecutePlanResult,
  ExecutePlanError,
  Backend | FileSystem | Git | GitHub | Shell | SystemTelemetry
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
    securityMode: passedSecurityMode,
  } = opts;

  // Use the passed securityMode if provided, otherwise fall back to config
  const securityMode = passedSecurityMode ?? config.security.profile;

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

    // Preflight: verify all plan-required commands are covered by the frozen set
    // before any git branch, worktree, or agent work begins.
    const preflightResult = checkRequiredCommands({
      requiredCommands: plan.run.requiredCommands,
      configCommands: config.security.agentCommands,
      gateCommands,
    });
    if (preflightResult.missing.length > 0) {
      return yield* Effect.fail(
        new SecurityPreflightError({
          message: [
            `Security preflight failed: the plan requires ${preflightResult.missing.length} command(s) not covered by the frozen set.`,
            `Missing: ${preflightResult.missing.map((c) => `"${c}"`).join(", ")}`,
            `Add the missing commands to security.agentCommands in phax.json before running.`,
          ].join("\n"),
          missing: preflightResult.missing,
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

    // Capture the resumed phase's persisted PhaseStatus BEFORE dispatching
    // RunResumeRequested — that dispatch lifts a gates_exhausted phase to
    // `running`, so reading after the dispatch would lose the marker we need to
    // take the gate-first re-entry path below.
    const resumePhase = plan.phases[startIndex];
    const resumePhaseFolderPath = resumePhase ? join(runPath, resumePhase.id) : undefined;
    const resumePhaseId = resumePhase?.id;
    let resumeFromGate = false;
    let resumeSessionId: string | undefined;
    let resumeWorktreePath: string | undefined;
    let resumeAttempt = 0;
    if (resumePhase !== undefined) {
      const infoResult = resolveRunByShortName(shortName, config.stateRoot);
      if (Either.isRight(infoResult)) {
        const phaseStatus = infoResult.right.phaseStatuses.find(
          (p) => p.phaseId === resumePhase.id,
        );
        if (phaseStatus?.state === "gates_exhausted") {
          resumeFromGate = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
          resumeAttempt =
            resumePhaseFolderPath !== undefined
              ? maxAttemptIndexInPhaseFolder(resumePhaseFolderPath)
              : 0;
        }
      }
    }

    // Lift a rate-limited run+phase back to running. On a fresh run the reducer
    // returns Ignored (run already running) and produces no writes; on resume
    // it transitions both the run and the in-flight phase to `running` so the
    // forward dispatches below treat the resumed phase as a normal new phase.
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
      const isResumeFromGate = i === startIndex && resumeFromGate;

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

      let phaseBranch: BranchName;
      let phaseFolderPath: string;
      let worktreePath: WorktreePath;
      let sessionId: ClaudeSessionId;
      let agentOptions: AgentRunOptions;

      if (isResumeFromGate) {
        // Resume-from-gate: the worktree, branch, prompt, model-resolution,
        // security posture, and Claude session were all written on the original
        // attempt. Re-enter the gate loop using the captured session — never
        // start a blind fix session if the session id is missing.
        if (resumeSessionId === undefined) {
          return yield* Effect.fail(
            new AgentSessionIdMissingError({
              message: `Cannot resume phase "${phase.id}" of run "${shortName}": no Claude session id is recorded on disk. Use \`phax reset-phase ${shortName}\` to start a new session for this phase.`,
              outputPath: resumePhaseFolderPath ?? "",
            }),
          );
        }
        if (resumeWorktreePath === undefined || !existsSync(resumeWorktreePath)) {
          return yield* Effect.fail(
            new WorktreeCreationError({
              message: `Cannot resume phase "${phase.id}" of run "${shortName}": worktree "${resumeWorktreePath ?? "<unknown>"}" no longer exists`,
              branch,
              path: resumeWorktreePath ?? "",
            }),
          );
        }
        const phaseBranchStr = `${plan.run.branch}--${phase.id}`;
        const phaseBranchResult = decodeBranchName(phaseBranchStr);
        if (Either.isLeft(phaseBranchResult)) {
          return yield* Effect.fail(
            new UnsafeGitStateError({
              message: `Invalid phase branch "${phaseBranchStr}"`,
              repoPath: config.repoRoot,
            }),
          );
        }
        phaseBranch = phaseBranchResult.right;
        phaseFolderPath = join(runPath, phase.id);
        const worktreePathResult = decodeWorktreePath(resumeWorktreePath);
        if (Either.isLeft(worktreePathResult)) {
          return yield* Effect.fail(
            new WorktreeCreationError({
              message: `Invalid worktree path "${resumeWorktreePath}"`,
              branch: phaseBranch,
              path: resumeWorktreePath,
            }),
          );
        }
        worktreePath = worktreePathResult.right;
        sessionId = resumeSessionId as ClaudeSessionId;
        currentPhaseId = phase.id;
        currentPhaseFolderPath = phaseFolderPath;
        currentWorktreePath = worktreePath as string;
        currentSessionId = sessionId as string;

        const securityPolicy = resolveSecurityPolicy({
          mode: securityMode,
          worktreePath: worktreePath as string,
          config: config.security,
        });
        // A binding is always written at phase launch, so on resume it must be
        // present. Use the locked provider/model/effort — never re-route. An
        // absent binding means the run state is corrupt (or predates the
        // feature, which is unsupported pre-public): fail loudly, don't reroute.
        const bindingEither = yield* Effect.promise(() => readAgentBinding(phaseFolderPath));
        if (Either.isLeft(bindingEither)) {
          return yield* Effect.fail(
            new RegistryCorruptionError({
              message: `Cannot resume phase "${phase.id}" of run "${shortName}": agent-binding.json is missing or unreadable (${bindingEither.left}).`,
              registryPath: join(phaseFolderPath, "agent-binding.json"),
            }),
          );
        }
        const binding = bindingEither.right;
        const resumeFrozenResult = computeFrozenAgentCommands({
          configCommands: securityPolicy.agentCommands,
          gateCommands,
          requiredCommands: plan.run.requiredCommands,
          provider: binding.provider,
        });
        agentOptions = {
          provider: binding.provider,
          model: binding.model,
          effort: binding.effort,
          cwd: worktreePath as string,
          security: securityPolicy,
          agentCommands: resumeFrozenResult.records.map((r) => r.command),
          outputJsonlPath: join(phaseFolderPath, "output.jsonl"),
          phaseFolderPath,
        };
      } else {
        // Each phase gets its own branch (<run.branch>--<phaseId>) so multiple
        // worktrees can coexist — git refuses to check out one branch in two
        // worktrees simultaneously.
        phaseBranch = yield* preparePhaseBranch(
          branch,
          phaseIdResult.right,
          previousPhaseBranch,
          config.repoRoot,
        );

        phaseFolderPath = yield* createPhaseFolder(runPath, phase, i, phaseBranch);
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
        worktreePath = yield* createPhaseWorktree(
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
        yield* dispatch(
          { ...eventBase(phase.id), type: "WorktreeCreated", path: worktreePath },
          ctx,
        );

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

        // The resolved policy is provider-independent (filesystem/network/mcp
        // come from config + worktree, not the provider), so compute it once
        // and reuse it for both the routing security filter and the selected
        // run.
        const securityPolicy = resolveSecurityPolicy({
          mode: securityMode,
          worktreePath: worktreePath as string,
          config: config.security,
        });
        const securityFilter: SecurityFilter = (provider) => {
          if (securityMode !== "secure") {
            return { allowed: true };
          }
          const evaluation = evaluateProviderSecurity(provider, securityPolicy);
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

        // Build and write security posture artifact
        const evaluation = evaluateProviderSecurity(resolution.selected.provider, securityPolicy);
        const frozenResult = computeFrozenAgentCommands({
          configCommands: securityPolicy.agentCommands,
          gateCommands,
          requiredCommands: plan.run.requiredCommands,
          provider: resolution.selected.provider,
        });
        const postureMarks: Array<"partial-filesystem" | "mcp-unenforced" | "command-precision"> = [
          ...evaluation.marks,
        ];
        if (frozenResult.degraded) {
          postureMarks.push("command-precision");
          process.stderr.write(
            `[phax] Warning: phase "${phase.id}" — command-precision enforcement is degraded for provider "${resolution.selected.provider}". Narrow allowances are not enforceable at command level (enforcement: none). See security.json for details.\n`,
          );
        }
        const securityPosture: SecurityPosture = {
          version: 1,
          mode: securityPolicy.mode,
          provider: resolution.selected.provider,
          sandboxEnabled: securityPolicy.mode === "secure",
          filesystem: {
            allowRead: securityPolicy.filesystem.allowRead,
            allowWrite: securityPolicy.filesystem.allowWrite,
          },
          network: {
            profile: securityPolicy.network.profile,
          },
          mcp: {
            mode: securityPolicy.mcp.mode,
            allow: securityPolicy.mcp.allow,
          },
          downgraded: evaluation.downgraded,
          marks: postureMarks,
          agentCommands: frozenResult.records,
          providerSkippedForSecurity: resolution.skippedForSecurity ?? [],
        };
        yield* fs.writeAtomic(
          join(phaseFolderPath, "security.json"),
          JSON.stringify(encodeSecurityPosture(securityPosture), null, 2),
        );

        // Emit security.policy.applied telemetry event
        yield* telemetry.recordEvent(
          makeSecurityPolicyAppliedTelemetryEvent({
            runId,
            operationId: phase.id,
            mode: securityPosture.mode,
            provider: securityPosture.provider,
            sandboxEnabled: securityPosture.sandboxEnabled,
            networkProfile: securityPosture.network.profile,
            mcpMode: securityPosture.mcp.mode,
            downgraded: securityPosture.downgraded,
            skippedForSecurity: securityPosture.providerSkippedForSecurity,
          }),
        );

        yield* Effect.tryPromise({
          try: () =>
            writeAgentBinding(phaseFolderPath, {
              version: 1,
              shortName: shortName as string,
              runId: runId as string,
              phaseId: phase.id,
              phaseIndex: i,
              phaseName: phase.title,
              provider: resolution.selected.provider,
              adapter: providerToAdapter(resolution.selected.provider),
              model: resolution.selected.concreteModel,
              effort: resolution.selected.thinking ?? phase.effort,
              sessionId: null,
              sessionHandle: null,
              worktreePath: worktreePath as string,
              cwd: worktreePath as string,
              launchedAt: new Date().toISOString(),
              status: "launching",
            }),
          catch: (err) =>
            new FsError({
              message: `Failed to write agent-binding.json: ${err instanceof Error ? err.message : String(err)}`,
              cause: err,
            }),
        });

        agentOptions = {
          provider: resolution.selected.provider,
          model: resolution.selected.concreteModel,
          effort: resolution.selected.thinking ?? phase.effort,
          cwd: worktreePath as string,
          security: securityPolicy,
          agentCommands: frozenResult.records.map((r) => r.command),
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
        sessionId = agentResult.sessionId;
        currentSessionId = sessionId as string;
        // Sole owner of the launching → running binding transition. persistSessionId
        // (called by real providers during streaming) writes session-id.txt and
        // patches status.json only; it no longer touches agent-binding.json.
        yield* Effect.promise(() =>
          patchAgentBindingSession(phaseFolderPath, {
            sessionId: sessionId as string,
            status: "running",
          }),
        );
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
      }

      // `ctx` is used by the FinalReviewOpened dispatch later in the loop.
      const ctx = dispatchCtx(phaseFolderPath, phase.id);

      // running → passed transition is dispatched inside fixLoop on the
      // gate-success branch via dispatch(GatePassed). On resume-from-gate the
      // loop starts at `resumeAttempt + 1` with a fresh fix budget so prior
      // attempt artifacts are preserved.
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
        ...(isResumeFromGate
          ? { startAttempt: resumeAttempt + 1, worktreePath: worktreePath as string }
          : {}),
      });

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

      // Reconcile after commit so diffNameStatus diffs HEAD^ against HEAD.
      const reconciliation = yield* reconcilePhaseFiles({
        phase,
        worktreePath,
        phaseFolderPath,
        runId: runId as string,
        fileReconciliationMode: config.fileReconciliationMode,
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
        reconciliation,
      });
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: phase.id,
          step: "handoff.generate",
          result: "success",
        }),
      );

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
        yield* Effect.promise(() =>
          patchAgentBindingStatus(phaseFolderPath, "awaiting_manual_review"),
        );

        // Auto-compliance review: runs before publish so the verdict can land in
        // the PR body. Review failure is non-fatal — the run stays in review_open.
        if (config.complianceReview?.enabled) {
          const reviewPolicy = resolveSecurityPolicy({
            mode: securityMode,
            worktreePath: infoResult.right.worktreePath,
            config: config.security,
          });
          const reviewSecurityFilter: SecurityFilter = (provider) => {
            if (securityMode !== "secure") {
              return { allowed: true };
            }
            const evaluation = evaluateProviderSecurity(provider, reviewPolicy);
            return evaluation.satisfiesStrict
              ? { allowed: true }
              : {
                  allowed: false,
                  reason: evaluation.marks.length
                    ? `cannot satisfy strict secure mode (${evaluation.marks.join(", ")})`
                    : "cannot satisfy strict secure mode",
                };
          };
          const reviewResolution = resolveModel(
            { model: config.complianceReview.model, effort: config.complianceReview.effort },
            routing,
            providerConfig,
            reviewSecurityFilter,
          );
          yield* reviewCompliance(
            infoResult.right,
            config.complianceReview,
            reviewResolution,
            { mode: securityMode, config: config.security },
            opts.verbose !== undefined ? { verbose: opts.verbose } : {},
          ).pipe(Effect.catchAll(() => Effect.void));
        }

        // Auto-publish: push the final branch and create a PR when configured.
        // Publication failure is non-fatal — the run stays in review_open and
        // failure details are recorded in publication.json / final-report.md.
        if (config.publish?.enabled) {
          yield* publishRun(infoResult.right, config.publish, {
            repoRoot: config.repoRoot,
            ...(opts.verbose !== undefined ? { verbose: opts.verbose } : {}),
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      } else {
        yield* Effect.promise(() => patchAgentBindingStatus(phaseFolderPath, "completed"));
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
    // Gate exhaustion pauses the run instead of failing it: FixAttemptsExhausted
    // was dispatched inside the fix loop (which performed the pause transition
    // and wrote resume-instructions.md), so we just re-raise here to ensure a
    // non-zero exit code. The run is already in `interrupted` state with phase
    // `gates_exhausted`, ready for `phax resume`.
    Effect.catchIf(isGateAttemptsExhaustedError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    Effect.tapError((e) =>
      isRateLimitError(e) || isNoChangesError(e) || isGateAttemptsExhaustedError(e)
        ? Effect.void
        : Effect.gen(function* () {
            if (currentPhaseFolderPath !== undefined) {
              yield* Effect.promise(() =>
                patchAgentBindingStatus(currentPhaseFolderPath!, "failed"),
              );
            }
            yield* dispatch(
              { ...eventBase(currentPhaseId), type: "RunFailed", cause: e },
              dispatchCtx(currentPhaseFolderPath, currentPhaseId),
            );
          }).pipe(Effect.catchAll(() => Effect.void)),
    ),
  );
}
