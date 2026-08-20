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
  ArtifactCompletionPausedError,
  CleanupPausedError,
  CommitPausedError,
  GateAttemptsExhaustedError,
  GateFailedError,
  HandoffPausedError,
  ModelPreflightError,
  PhaseHadNoChangesError,
  RateLimitError,
  RecordsDestinationRefusedError,
  RecordsSyncRequiredError,
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
import { completeRunArtifacts, type RunCompletionReport } from "./completeRunArtifacts.js";
import { publishRun } from "./publishRun.js";
import { reviewCompliance } from "./reviewCompliance.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeAdapterCallFailedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
  makeModelResolvedTelemetryEvent,
  makeOrientBriefComputedTelemetryEvent,
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
import { preflightPhaseModels } from "../domain/routing/preflight.js";
import { resolveModel } from "../domain/routing/resolve.js";
import type { SecurityFilter } from "../domain/routing/types.js";
import type { McpMode, SecurityMode } from "../domain/security/types.js";
import { evaluateProviderSecurity } from "../domain/security/capabilities.js";
import {
  checkRequiredCommands,
  computeFrozenAgentCommands,
} from "../domain/security/agentCommands.js";
import { resolveSecurityPolicy } from "../domain/security/resolvePolicy.js";
import { cleanupPhase } from "./cleanup.js";
import { commitPhase } from "./commit.js";
import { writeRecord } from "./writeRecord.js";
import { checkRecordsRunPreflight, recordsClonePath } from "./recordsSync.js";
import type { RecordPhaseOutcome } from "../schemas/runRecord.js";
import type { ProviderId } from "../domain/routing/types.js";
import { reconcilePhaseFiles } from "./reconcilePhaseFiles.js";
import { dispatch, type DispatcherContext } from "./dispatcher.js";
import { excerpt, queryOrientIndex } from "./orient.js";
import type { OrientRow } from "../schemas/orient.js";
import { encodeOrientBrief, type OrientBrief } from "../schemas/orientBrief.js";
import { MAX_ORIENTATION_ROWS } from "./promptGeneration.js";
import { recordGateProfileInRunStatus, resolveGateProfile } from "./gates.js";
import { runGatesWithFixLoop } from "./fixLoop.js";
import { generatePhaseHandoff, HandoffValidationError } from "./handoffGeneration.js";
import { readPreviousHandoff, readPreviousReconciliation } from "./handoffInjection.js";
import type { ReconciliationResult } from "../domain/reconciliation/types.js";
import { decodePhaseFileReconciliation } from "../schemas/reconciliation.js";
import { createPhaseFolder } from "./phaseFolder.js";
import { recordPhaseWorktreeAndBranch } from "./phaseStatusUpdates.js";
import { buildPhasePrompt } from "./promptGeneration.js";
import { resolveRun } from "./resolveRunInfo.js";
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

function isHandoffPausedError(e: unknown): e is HandoffPausedError {
  return e instanceof HandoffPausedError;
}

function isCommitPausedError(e: unknown): e is CommitPausedError {
  return e instanceof CommitPausedError;
}

function isCleanupPausedError(e: unknown): e is CleanupPausedError {
  return e instanceof CleanupPausedError;
}

function isArtifactCompletionPausedError(e: unknown): e is ArtifactCompletionPausedError {
  return e instanceof ArtifactCompletionPausedError;
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
  readonly namespace: string;
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
  // Repo-relative POSIX path of the plan that produced this run, supplied by the
  // caller (run.ts / resume.ts) — executePlan never derives it. When present the
  // final phase applies the plan's Approved → Completed transition on the run
  // branch (spec 27). Absent for callers with no lifecycle artifact to complete
  // (most tests); completeRunArtifacts is itself a no-op for loose paths.
  readonly planRepoRelPath?: string | undefined;
}

export interface ExecutePlanResult {
  readonly committedPhases: readonly string[];
  readonly finalPhaseId: string;
  readonly finalWorktreePath: WorktreePath;
  readonly prUrl?: string;
  readonly artifactCompletions?: RunCompletionReport;
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
  | HandoffPausedError
  | CommitPausedError
  | CleanupPausedError
  | ArtifactCompletionPausedError
  | ArchiveBlockedByDirtyWorktreeError
  | RegistryCorruptionError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | SecurityPreflightError
  | ModelPreflightError
  | PhaseHadNoChangesError
  | RecordsDestinationRefusedError
  | RecordsSyncRequiredError;

export function mcpAllowlistPreflight(mcp: {
  readonly mode: McpMode;
  readonly allow: readonly string[];
}): Effect.Effect<void, SecurityPreflightError, FileSystem> {
  if (mcp.mode !== "allowlist") return Effect.void;
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const missing: string[] = [];
    for (const entry of mcp.allow) {
      const ok = yield* fs.exists(entry).pipe(Effect.orElse(() => Effect.succeed(false)));
      if (!ok) missing.push(entry);
    }
    if (missing.length > 0) {
      return yield* Effect.fail(
        new SecurityPreflightError({
          message: [
            `Security preflight failed: ${missing.length} mcp.allow ${missing.length === 1 ? "entry does" : "entries do"} not resolve to a readable file.`,
            `Missing: ${missing.map((e) => `"${e}"`).join(", ")}`,
            `mcp.allow entries must be paths to MCP server config files (not server names).`,
          ].join("\n"),
          missing,
        }),
      );
    }
  });
}

export function executePlan(
  opts: ExecutePlanOptions,
): Effect.Effect<
  ExecutePlanResult,
  ExecutePlanError,
  Backend | FileSystem | Git | GitHub | Shell | SystemTelemetry
> {
  const {
    shortName,
    namespace,
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
  // The resolved provider/model/effort in flight, captured once agentOptions is
  // known, so a record can be written for a phase that fails after the agent ran.
  let currentProvider: ProviderId | undefined;
  let currentModel: string | undefined;
  let currentEffort: string | undefined;

  // Records (spec §5.1): one record per phase at its terminal outcome. A single
  // helper writes both the committed and the failed case so the two cannot
  // drift, and the guard set makes it exactly one per phase.
  const recordedPhaseIds = new Set<string>();
  function writeRecordForPhase(args: {
    readonly phaseId: string;
    readonly phaseFolderPath: string;
    readonly provider: ProviderId;
    readonly model: string;
    readonly effort: string;
    readonly sessionId: string | undefined;
    readonly outcome: RecordPhaseOutcome;
    readonly sourceSha?: string | undefined;
    // A destination refusal (spec §5.4) is a deliberate policy decision, not
    // a transient write failure, so it is not swallowed into a warning the
    // way I/O failures are — except at the failed-phase call site, which
    // runs inside Effect.tapError over the phase's own original failure and
    // must never let a records concern mask it. Defaults to failing hard.
    readonly failOnRefusal?: boolean;
  }): Effect.Effect<void, RecordsDestinationRefusedError, Git | FileSystem | GitHub> {
    if (!config.records.enabled || recordedPhaseIds.has(args.phaseId)) return Effect.void;
    return Effect.gen(function* () {
      const result = yield* writeRecord({
        repoRoot: config.repoRoot,
        phaseFolderPath: args.phaseFolderPath,
        runId: runId as string,
        phaseId: args.phaseId,
        provider: args.provider,
        model: args.model,
        effort: args.effort,
        outcome: args.outcome,
        records: config.records,
        ...(config.records.destination.kind === "repo"
          ? { recordsClonePath: recordsClonePath(config.stateRoot, namespace) }
          : {}),
        ...(args.sourceSha !== undefined ? { sourceSha: args.sourceSha } : {}),
        ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
      }).pipe(
        // A record-write I/O failure never fails the run — it degrades to a warning.
        Effect.catchAll((e) =>
          Effect.sync(() => {
            process.stderr.write(
              `[phax] Warning: phase "${args.phaseId}" — failed to write record (${e instanceof Error ? e.message : String(e)}).\n`,
            );
            return { kind: "records-off" } as const;
          }),
        ),
      );

      if (result.kind === "written") {
        recordedPhaseIds.add(args.phaseId);
        return;
      }
      if (result.kind === "refused") {
        const message = `Phase "${args.phaseId}" — records destination refused: ${result.message} (remedy: ${result.remedy})`;
        if (args.failOnRefusal === false) {
          process.stderr.write(`[phax] Warning: ${message}\n`);
          return;
        }
        return yield* Effect.fail(
          new RecordsDestinationRefusedError({
            message,
            phaseId: args.phaseId,
            reason: result.reason,
            remedy: result.remedy,
          }),
        );
      }
    });
  }

  // These errors pause the run (interrupted, resumable via `phax resume`) rather
  // than terminally failing it; every other error is a terminal RunFailed. A
  // pause is not a terminal phase outcome — the phase resumes in a later process
  // and reaches committed/failed there — so no record is written for one, which
  // also avoids a duplicate record when the resumed phase later commits. Kept in
  // lockstep with the RunFailed guard at the end of the pipe (§5.1).
  function isResumablePauseError(e: unknown): boolean {
    return (
      isRateLimitError(e) ||
      isNoChangesError(e) ||
      isGateAttemptsExhaustedError(e) ||
      isHandoffPausedError(e) ||
      isCommitPausedError(e) ||
      isCleanupPausedError(e) ||
      isArtifactCompletionPausedError(e)
    );
  }

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
    const git = yield* Git;

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

    // Preflight: verify all mcp.allow entries resolve to readable files before
    // any branch/worktree/agent work begins.
    yield* mcpAllowlistPreflight(config.security.mcp);

    // Preflight: a dedicated records destination with no local clone yet
    // refuses the run before any phase spawns (spec §5.7) — phax never clones
    // on its own here, so this only checks and names `phax records sync`.
    const recordsPreflight = yield* checkRecordsRunPreflight({
      records: config.records,
      stateRoot: config.stateRoot,
      namespace,
    });
    if (recordsPreflight.kind === "refused") {
      return yield* Effect.fail(
        new RecordsSyncRequiredError({
          message: recordsPreflight.message,
          path: recordsPreflight.path,
          remote: recordsPreflight.remote,
        }),
      );
    }

    // Preflight: validate every phase's model and effort against the catalog
    // before any git branch, worktree, or agent work begins.
    const modelPreflight = preflightPhaseModels(plan.phases, routing, providerConfig);
    if (modelPreflight.failures.length > 0) {
      const lines: string[] = [
        `Model preflight failed: ${modelPreflight.failures.length} phase(s) have invalid model configuration.`,
      ];
      for (const failure of modelPreflight.failures) {
        lines.push(`\n  ${failure.phaseId} (${failure.model}/${failure.effort}):`);
        for (const reason of failure.reasons) {
          lines.push(`    - ${reason}`);
        }
        if (failure.alternatives.length > 0) {
          lines.push(`    Alternatives:`);
          for (const alt of failure.alternatives) {
            lines.push(`      ${alt.id} (${alt.family}): ${alt.efforts.join(", ")}`);
          }
        }
      }
      return yield* Effect.fail(
        new ModelPreflightError({
          message: lines.join("\n"),
          failures: modelPreflight.failures.map((f) => ({
            phaseId: f.phaseId,
            model: f.model,
            effort: f.effort,
            reasons: f.reasons,
            alternatives: f.alternatives.map((a) => ({
              id: a.id,
              family: a.family,
              efforts: a.efforts,
            })),
          })),
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
    let resumeFromHandoff = false;
    let resumeFromCommit = false;
    let resumeFromCleanup = false;
    let resumeFromCompletion = false;
    let resumeSessionId: string | undefined;
    let resumeWorktreePath: string | undefined;
    let resumeAttempt = 0;
    if (resumePhase !== undefined) {
      const infoResult = resolveRun(namespace, shortName, config.stateRoot);
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
        } else if (phaseStatus?.state === "handoff_failed") {
          resumeFromHandoff = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (phaseStatus?.state === "passed") {
          resumeFromCommit = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (phaseStatus?.state === "cleaning_up") {
          resumeFromCleanup = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (phaseStatus?.state === "committed" && startIndex === plan.phases.length - 1) {
          // A `committed` final phase means the run paused at artifact completion
          // (ArtifactCompletionFailed): commit/handoff already landed, only the
          // completion step remains. `committed` is transient for non-final
          // phases (they pause as `cleaning_up`), so the final-phase guard is what
          // distinguishes this re-entry.
          resumeFromCompletion = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
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
    let publishedPrUrl: string | undefined;
    let artifactCompletions: RunCompletionReport | undefined;

    for (let i = startIndex; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      if (phase === undefined) continue;
      const isFinal = i === plan.phases.length - 1;
      const isResumeFromGate = i === startIndex && resumeFromGate;
      const isResumeFromHandoff = i === startIndex && resumeFromHandoff;
      const isResumeFromCommit = i === startIndex && resumeFromCommit;
      const isResumeFromCleanup = i === startIndex && resumeFromCleanup;
      const isResumeFromCompletion = i === startIndex && resumeFromCompletion;

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

      if (
        isResumeFromGate ||
        isResumeFromHandoff ||
        isResumeFromCommit ||
        isResumeFromCleanup ||
        isResumeFromCompletion
      ) {
        // Resume-from-gate / -handoff / -commit / -cleanup / -completion: the
        // worktree, branch, model-resolution, security posture, and Claude session were
        // all written on the original attempt. Re-enter at the appropriate step using the
        // captured session — never start a blind fix/handoff session if the session id is missing.
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
          orientEnabled: config.orient !== undefined,
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
          namespace,
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

        const fs = yield* FileSystem;

        // Advisory orientation brief: a provider failure must never fail, block,
        // or retry the phase (spec §5.4) — a typed Either failure just skips
        // weaving and leaves the prompt unchanged.
        let orientationIndex: readonly OrientRow[] | undefined;
        let orientBrief: OrientBrief;
        if (config.orient !== undefined) {
          const plannedFiles = Array.from(
            new Set([
              ...phase.plannedFilesToCreate,
              ...phase.plannedFilesToEdit,
              ...phase.optionalFilesToEdit,
            ]),
          );
          const orientResult = yield* queryOrientIndex(
            config.orient,
            plannedFiles,
            worktreePath as string,
          );
          if (Either.isRight(orientResult)) {
            orientationIndex = orientResult.right.rows;
            orientBrief = {
              kind: "ok",
              files: plannedFiles,
              rows: orientResult.right.rows,
              rowCount: orientResult.right.rows.length,
              wovenRowCount: Math.min(orientResult.right.rows.length, MAX_ORIENTATION_ROWS),
            };
            yield* telemetry.recordEvent(
              makeOrientBriefComputedTelemetryEvent({
                runId,
                operationId: phase.id,
                phase: phase.id,
                fileCount: plannedFiles.length,
                rowCount: orientResult.right.rows.length,
              }),
            );
          } else {
            orientBrief = {
              kind: "failed",
              files: plannedFiles,
              error: excerpt(orientResult.left.message),
            };
            process.stderr.write(
              `[phax] Warning: phase "${phase.id}" — orient provider query failed (${orientResult.left.message}). Dispatching without an orientation brief.\n`,
            );
          }
        } else {
          orientBrief = { kind: "not-configured" };
        }

        // Evidence, not a gate: a failure to persist the brief must never fail
        // the phase, mirroring the provider-failure handling above.
        yield* fs
          .writeAtomic(
            join(phaseFolderPath, "orient-brief.json"),
            JSON.stringify(encodeOrientBrief(orientBrief), null, 2),
          )
          .pipe(
            Effect.catchAll((err) =>
              Effect.sync(() => {
                process.stderr.write(
                  `[phax] Warning: phase "${phase.id}" — failed to write orient-brief.json (${err.message}).\n`,
                );
              }),
            ),
          );

        const promptGateCommands = config.raw.gateProfiles[gateProfileId]?.flat(1) ?? [];
        const promptText = buildPhasePrompt({
          planMd,
          planJson: plan,
          currentPhase: phase,
          previousHandoff,
          previousReconciliation,
          gateCommands: promptGateCommands,
          ...(orientationIndex !== undefined ? { orientationIndex } : {}),
        });

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
          orientEnabled: config.orient !== undefined,
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

      // Capture the resolved binding for the records writer — including the
      // failure path, which reads these from the outer scope.
      currentProvider = agentOptions.provider;
      currentModel = agentOptions.model;
      currentEffort = agentOptions.effort;

      if (
        !isResumeFromHandoff &&
        !isResumeFromCommit &&
        !isResumeFromCleanup &&
        !isResumeFromCompletion
      ) {
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
      }

      if (!isResumeFromHandoff && !isResumeFromCleanup && !isResumeFromCompletion) {
        // commitPhase dispatches CommitCreated internally.
        // If the commit fails for a reason other than no-changes (e.g. a pre-commit
        // hook rejection), dispatch CommitFailed to pause the run as `interrupted`
        // with the phase left `passed`, then re-raise as CommitPausedError so the
        // top-level guard skips RunFailed.
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
        }).pipe(
          Effect.catchIf(
            (e): e is Exclude<typeof e, PhaseHadNoChangesError> =>
              !(e instanceof PhaseHadNoChangesError),
            (e) =>
              Effect.gen(function* () {
                const reason = e instanceof Error ? e.message : String(e);
                yield* dispatch(
                  {
                    ...eventBase(phase.id),
                    type: "CommitFailed" as const,
                    phaseId: phase.id as PhaseId,
                    worktreePath,
                    sessionId,
                    reason,
                  },
                  ctx,
                );
                yield* telemetry.recordEvent(
                  makeAdapterCallFailedTelemetryEvent({
                    runId,
                    operationId: phase.id,
                    adapter: "git",
                    operation: "commit.create",
                    exitCode: 1,
                    stderrExcerpt: reason.slice(0, 500),
                  }),
                );
                return yield* Effect.fail(
                  new CommitPausedError({
                    message: `Commit step failed for phase "${phase.id}": ${reason}`,
                    phaseId: phase.id,
                    cause: e,
                  }),
                );
              }),
          ),
        );

        committedPhases.push(phase.id);
        yield* telemetry.recordEvent(
          makeAdapterCallSucceededTelemetryEvent({
            runId,
            operationId: phase.id,
            adapter: "git",
            operation: "commit.create",
          }),
        );
      }

      if (!isResumeFromCleanup && !isResumeFromCompletion) {
        let reconciliation: ReconciliationResult;
        if (isResumeFromHandoff) {
          // The phase already committed; read the persisted reconciliation rather than
          // re-diffing HEAD (the worktree is clean and the diff would be empty).
          const fs = yield* FileSystem;
          const reconRaw = yield* fs.readText(join(phaseFolderPath, "file-reconciliation.json"));
          const reconDecoded = decodePhaseFileReconciliation(JSON.parse(reconRaw));
          reconciliation = Either.isRight(reconDecoded)
            ? reconDecoded.right
            : {
                createdAsPlanned: [],
                editedAsPlanned: [],
                missingPlannedCreate: [],
                missingPlannedEdit: [],
                createdButPlannedEdit: [],
                editedButPlannedCreate: [],
                unplannedCreated: [],
                unplannedEdited: [],
                optionalTouched: [],
                deletions: [],
                renames: [],
                hasDeviations: false,
              };
        } else {
          // Reconcile after commit so diffNameStatus diffs HEAD^ against HEAD.
          reconciliation = yield* reconcilePhaseFiles({
            phase,
            worktreePath,
            phaseFolderPath,
            runId: runId as string,
            fileReconciliationMode: config.fileReconciliationMode,
          });
        }

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
        }).pipe(
          Effect.catchTags({
            HandoffValidationError: (e) =>
              Effect.gen(function* () {
                yield* dispatch(
                  {
                    ...eventBase(phase.id),
                    type: "HandoffMissing",
                    missingSections: e.missingSections,
                  },
                  ctx,
                );
                yield* telemetry.recordEvent(
                  makeStepCompletedTelemetryEvent({
                    runId,
                    operationId: phase.id,
                    step: "handoff.generate",
                    result: "failure",
                  }),
                );
                return yield* Effect.fail(
                  new HandoffPausedError({
                    message: `Phase "${phase.id}" handoff generation failed: missing sections [${e.missingSections.join(", ")}]`,
                    phaseId: phase.id,
                    cause: e,
                  }),
                );
              }),
            AgentInvocationError: (e) =>
              Effect.gen(function* () {
                yield* dispatch(
                  {
                    ...eventBase(phase.id),
                    type: "HandoffMissing",
                    missingSections: [],
                  },
                  ctx,
                );
                yield* telemetry.recordEvent(
                  makeStepCompletedTelemetryEvent({
                    runId,
                    operationId: phase.id,
                    step: "handoff.generate",
                    result: "failure",
                  }),
                );
                return yield* Effect.fail(
                  new HandoffPausedError({
                    message: `Phase "${phase.id}" handoff generation failed: ${e.message}`,
                    phaseId: phase.id,
                    cause: e,
                  }),
                );
              }),
          }),
        );
        yield* telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId,
            operationId: phase.id,
            step: "handoff.generate",
            result: "success",
          }),
        );
      }

      // Terminal committed outcome: assemble and write this phase's record onto
      // phax/records/v1 before any run-completion bookkeeping, so no record is
      // ever written for phax's own archival commit (spec §5.1). The source sha
      // is the phase commit, resolved from the worktree HEAD; a lookup failure
      // simply omits the back-reference rather than failing the phase.
      if (config.records.enabled) {
        const recordSourceSha = yield* git
          .headCommit(worktreePath as string)
          .pipe(Effect.orElseSucceed(() => undefined as string | undefined));
        yield* writeRecordForPhase({
          phaseId: phase.id,
          phaseFolderPath,
          provider: agentOptions.provider,
          model: agentOptions.model,
          effort: agentOptions.effort,
          sessionId: sessionId as string,
          outcome: "committed",
          ...(recordSourceSha !== undefined ? { sourceSha: recordSourceSha } : {}),
        });
      }

      if (isFinal) {
        finalWorktreePath = worktreePath;
        finalPhaseId = phase.id;

        const infoResult = resolveRun(namespace, shortName, config.stateRoot);
        if (Either.isLeft(infoResult)) {
          return yield* Effect.fail(
            new RegistryCorruptionError({
              message: `Failed to resolve run "${shortName}" for final review: ${infoResult.left}`,
              registryPath: join(config.stateRoot, "registry.json"),
            }),
          );
        }
        // Run completion (spec 27): apply the plan's Approved → Completed
        // transition on the run branch — riding the source spec along where the
        // chain gate allows — BEFORE review opens, so the reviewer sees the
        // completion in the branch they review and the merge lands work and record
        // together. This runs after the phase's handoff and before FinalReviewOpened
        // (which generates review-handoff.md / final-report.md); completing after
        // would describe a branch not yet carrying its own completion. A failure
        // dispatches ArtifactCompletionFailed (pausing the run as `interrupted`
        // with the final phase left `committed`) and re-raises as
        // ArtifactCompletionPausedError so the top-level guard skips RunFailed.
        // Idempotent, so a resume that partially succeeded re-applies nothing.
        if (opts.planRepoRelPath !== undefined && opts.planRepoRelPath.length > 0) {
          artifactCompletions = yield* completeRunArtifacts({
            worktreePath: worktreePath as string,
            planRepoRelPath: opts.planRepoRelPath,
            nowIso: new Date().toISOString(),
          }).pipe(
            Effect.catchAll((e) =>
              Effect.gen(function* () {
                const reason = e instanceof Error ? e.message : String(e);
                yield* dispatch(
                  {
                    ...eventBase(phase.id),
                    type: "ArtifactCompletionFailed" as const,
                    phaseId: phase.id as PhaseId,
                    worktreePath,
                    reason,
                  },
                  ctx,
                );
                return yield* Effect.fail(
                  new ArtifactCompletionPausedError({
                    message: `Artifact completion failed for phase "${phase.id}": ${reason}`,
                    phaseId: phase.id,
                    cause: e,
                  }),
                );
              }),
            ),
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
        if (config.publish?.auto) {
          const publicationResult = yield* publishRun(infoResult.right, config.publish, {
            repoRoot: config.repoRoot,
            ...(opts.verbose !== undefined ? { verbose: opts.verbose } : {}),
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          if (publicationResult?.kind === "published" && publicationResult.prUrl !== undefined) {
            publishedPrUrl = publicationResult.prUrl;
          }
        }
      } else {
        yield* Effect.promise(() => patchAgentBindingStatus(phaseFolderPath, "completed"));
        // cleanupPhase dispatches CleanupStarted/CleanupCompleted internally.
        // If cleanup fails (dirty worktree, setup command failure, git error), dispatch
        // CleanupFailed to pause the run as `interrupted` with the phase in `cleaning_up`,
        // then re-raise as CleanupPausedError so the top-level guard skips RunFailed.
        yield* cleanupPhase({
          worktreePath,
          phaseFolderPath,
          cleanupCommands,
          repoRoot: config.repoRoot,
          isFinalPhase: false,
          runPath,
          shortName: shortName as string,
          phaseId: phase.id,
        }).pipe(
          Effect.catchAll((e) =>
            Effect.gen(function* () {
              const reason = e instanceof Error ? e.message : String(e);
              yield* dispatch(
                {
                  ...eventBase(phase.id),
                  type: "CleanupFailed" as const,
                  phaseId: phase.id as PhaseId,
                  worktreePath,
                  reason,
                },
                ctx,
              );
              return yield* Effect.fail(
                new CleanupPausedError({
                  message: `Cleanup step failed for phase "${phase.id}": ${reason}`,
                  phaseId: phase.id,
                  cause: e,
                }),
              );
            }),
          ),
        );
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
      ...(publishedPrUrl !== undefined ? { prUrl: publishedPrUrl } : {}),
      ...(artifactCompletions !== undefined ? { artifactCompletions } : {}),
    };
  });

  return program.pipe(
    // Records (spec §5.1): a phase that terminally failed never reaches the
    // committed path, so write its record here from the in-flight phase's
    // captured binding. Resumable pauses are skipped — they are not terminal
    // outcomes, and the phase writes its record when it later commits or fails.
    // Best-effort — never masks the original failure, and a no-op when records
    // are off or the phase never resolved a provider binding.
    Effect.tapError((e) =>
      !isResumablePauseError(e) &&
      currentPhaseId !== undefined &&
      currentPhaseFolderPath !== undefined &&
      currentProvider !== undefined &&
      currentModel !== undefined &&
      currentEffort !== undefined
        ? writeRecordForPhase({
            phaseId: currentPhaseId,
            phaseFolderPath: currentPhaseFolderPath,
            provider: currentProvider,
            model: currentModel,
            effort: currentEffort,
            sessionId: currentSessionId,
            outcome: "failed",
            failOnRefusal: false,
          }).pipe(Effect.catchAll(() => Effect.void))
        : Effect.void,
    ),
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
    // A post-commit handoff failure pauses the run instead of failing it:
    // HandoffMissing was dispatched at the catch site inside the phase loop
    // (which performs the pause transition to interrupted+handoff_failed), so we
    // just re-raise here. The run is already in `interrupted` state, ready for
    // `phax resume` to re-run only the handoff.
    Effect.catchIf(isHandoffPausedError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    // A commit-step failure after a passed gate pauses the run instead of failing
    // it: CommitFailed was dispatched at the catch site inside the phase loop
    // (which performs the pause transition to interrupted+passed), so we just
    // re-raise here. The run is already in `interrupted` state with phase `passed`,
    // ready for `phax resume` to re-run commit → handoff → cleanup.
    Effect.catchIf(isCommitPausedError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    // A cleanup-step failure after the commit pauses the run instead of failing
    // it: CleanupFailed was dispatched at the catch site inside the phase loop
    // (which performs the pause transition to interrupted+cleaning_up), so we
    // just re-raise here. The run is already in `interrupted` state with phase
    // `cleaning_up`, ready for `phax resume` to re-run only cleanup.
    Effect.catchIf(isCleanupPausedError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    // An artifact-completion failure after the final phase committed pauses the
    // run instead of failing it: ArtifactCompletionFailed was dispatched at the
    // catch site inside the isFinal block (performing the pause transition to
    // interrupted with the final phase left `committed`), so we just re-raise
    // here. The run is ready for `phax resume` to re-run only the completion step.
    Effect.catchIf(isArtifactCompletionPausedError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    Effect.tapError((e) =>
      isResumablePauseError(e)
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
