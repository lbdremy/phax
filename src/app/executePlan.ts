import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
import { selectGateSteps } from "../domain/gate/selectSteps.js";
import { lastRecordedAttemptLogName } from "../domain/gate/attemptFiles.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  AgentInvocationError,
  AgentSessionIdMissingError,
  ArtifactCompletionPausedError,
  AwaitingReviewStopError,
  CleanupPausedError,
  CommitPausedError,
  GateAttemptsExhaustedError,
  GateFailedError,
  GateStepRefusedError,
  HandoffPausedError,
  HoldPointPausedError,
  ModelPreflightError,
  PhaseHadNoChangesError,
  type AssignmentPreflightError,
  InteractivePreflightError,
  type InvalidTransitionError,
  OracleCommitMissingError,
  OraclePreflightError,
  type PlanSectionsPreflightError,
  RateLimitError,
  RecordsDestinationRefusedError,
  RecordsSyncRequiredError,
  RegistryCorruptionError,
  SecurityEnforcementError,
  SecurityPreflightError,
  SetupCommandFailedError,
  SkillEditConsentError,
  StopCloseRefusedError,
  StopRecordPausedError,
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
import {
  completeRunArtifacts,
  renderSourceSpecOutcome,
  SOURCE_SPEC_OUTCOME_FILENAME,
  type RunCompletionReport,
} from "./completeRunArtifacts.js";
import { withInvocationCost } from "./costLedger.js";
import { publishRun } from "./publishRun.js";
import { reviewCompliance } from "./reviewCompliance.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeAdapterCallFailedTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
  makeModelResolvedTelemetryEvent,
  makeSecurityPolicyAppliedTelemetryEvent,
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { reportAgentFailure } from "./telemetry/reportBuilders.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { encodeSecurityPosture, type SecurityPosture } from "../schemas/securityPosture.js";
import type { PhaxPlan, PhaxPlanPhase } from "../schemas/phaxPlan.js";
import type { ModelRouting } from "../schemas/modelRouting.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import { DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG } from "../domain/routing/defaults.js";
import { resolveModel } from "../domain/routing/resolve.js";
import type { SecurityMode } from "../domain/security/types.js";
import { evaluateProviderSecurity, securityFilterFor } from "../domain/security/capabilities.js";
import { computeFrozenAgentCommands } from "../domain/security/agentCommands.js";
import { resolveSecurityPolicy } from "../domain/security/resolvePolicy.js";
import { phaseSkillEditGrants } from "../domain/security/skillEditGrants.js";
import { cleanupPhase } from "./cleanup.js";
import { commitPhase } from "./commit.js";
import { writeRecord, type RecordUsageSource } from "./writeRecord.js";
import { recordsClonePath } from "./recordsSync.js";
import { runPreflights } from "./runPreflight.js";
import type { RecordPhaseOutcome, RecordStop } from "../schemas/runRecord.js";
import type { PhaseMode } from "../schemas/phaxPlan.js";
import { recordStopFromPersisted, recordStopOf } from "../domain/records/stopRecord.js";
import { tracedStep } from "./telemetry/stopTelemetry.js";
import type { ProviderId } from "../domain/routing/types.js";
import { reconcilePhaseFiles } from "./reconcilePhaseFiles.js";
import { dispatch, type DispatcherContext } from "./dispatcher.js";
import {
  ORACLE_PROVIDER_TIMEOUT_MS,
  recordGateProfileInRunStatus,
  serializeGateRequest,
  serializeOracleRequest,
  type OracleStep,
} from "./gates.js";
import { makeGateRequest } from "../domain/gate/gateRequest.js";
import { phaseBriefRequest } from "../domain/brief/request.js";
import type { BriefRequestFile } from "../schemas/brief.js";
import type { GateRequest } from "../schemas/gateRequest.js";
import { stampBriefRequest } from "./briefProvider.js";
import { PHASE_BRIEF_REQUEST_FILE, pushBrief, writePhaseBriefRequest } from "./pushedBrief.js";
import { closePulledBriefs } from "./pullBrief.js";
import { readRunHold } from "./resume.js";
import { runGatesWithFixLoop } from "./fixLoop.js";
import { generatePhaseHandoff, HandoffValidationError } from "./handoffGeneration.js";
import {
  committedHandoffIsValid,
  readPreviousHandoff,
  readPreviousReconciliation,
  readReviewCorrections,
} from "./handoffInjection.js";
import {
  readExecutedHandoffs,
  readInteractiveSession,
  readModelResolution,
  readPhasePosture,
} from "./interactiveFiles.js";
import { stopAtDeclaredPhase, stopAtHeldPhase } from "./interactiveStop.js";
import { holdsPhase } from "../domain/hold.js";
import type { PhaseStatus, RunHold } from "../schemas/status.js";
import { closeStop, type CloseReport } from "./closeStop.js";
import { listRecords } from "./recordsList.js";
import type { ReconciliationResult } from "../domain/reconciliation/types.js";
import { readPhaseFileReconciliationFile } from "../schemas/persisted.js";
import { createPhaseFolder } from "./phaseFolder.js";
import {
  readPhaseBase,
  readPhaseCommit,
  readPhaseStatus,
  recordPhaseWorktreeAndBranch,
} from "./phaseStatusUpdates.js";
import { buildPhasePrompt } from "./promptGeneration.js";
import { resolveRun } from "./resolveRunInfo.js";
import { countCompletedPhases } from "../domain/completedPhases.js";
import { setupPhase } from "./setup.js";
import {
  createPhaseWorktree,
  preparePhaseBranch,
  prepareRunBranch,
  writePhasePlanFile,
} from "./worktree.js";
import {
  writeAgentBinding,
  patchAgentBindingSession,
  patchAgentBindingStatus,
  readAgentBinding,
} from "./agentBinding.js";
import { providerToAdapter } from "../domain/providerAdapter.js";
import {
  dischargedOracleFiles,
  latestAuthoredCommit,
  oracleRoleOf,
  recordOracleRole,
  type OraclePair,
} from "../domain/plan/oraclePairs.js";
import { oracleFindings } from "../domain/plan/oracleCheck.js";
import { readPhaseHeaders } from "../domain/plan/phaseHeader.js";
import { makeOracleRequest } from "../domain/gate/oracleRequest.js";

function isRateLimitError(e: unknown): e is RateLimitError | UsageLimitError {
  return e instanceof RateLimitError || e instanceof UsageLimitError;
}

function isNoChangesError(e: unknown): e is PhaseHadNoChangesError {
  return e instanceof PhaseHadNoChangesError;
}

function isGateAttemptsExhaustedError(e: unknown): e is GateAttemptsExhaustedError {
  return e instanceof GateAttemptsExhaustedError;
}

function isGateStepRefusedError(e: unknown): e is GateStepRefusedError {
  return e instanceof GateStepRefusedError;
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

function isHoldPointPausedError(e: unknown): e is HoldPointPausedError {
  return e instanceof HoldPointPausedError;
}

function isStopRecordPausedError(e: unknown): e is StopRecordPausedError {
  return e instanceof StopRecordPausedError;
}

// A stop reached or a close refused leaves the run awaiting review: the
// reducer already moved it there, so nothing more is dispatched.
function isReviewStopError(e: unknown): e is AwaitingReviewStopError | StopCloseRefusedError {
  return e instanceof AwaitingReviewStopError || e instanceof StopCloseRefusedError;
}

/**
 * What a stop's record needs, read before RunResumeRequested: the phase's
 * assignment (a held phase's builder binding, a declared phase's routed
 * assignment), its usage source, and, on a closed stop's re-entry, the phase
 * commit and the stop as its files recorded it.
 */
interface StopRecordInputs {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly usage: RecordUsageSource;
  /** The phase commit; unknown before a declared close, which makes it. */
  readonly sourceSha: string | undefined;
  /** The record's stop on a closed stop's re-entry; undefined before the close. */
  readonly closedStop: NonNullable<RecordStop> | undefined;
}

// What follows the valid handoff of a committed phase whose record and cleanup
// never ran (its handoff was written by hand), read before RunResumeRequested:
// its branch, its worktree (null when the directory is gone) and what its
// record names.
interface PostHandoffInputs {
  readonly branch: BranchName;
  readonly worktree: WorktreePath | null;
  /** The builder's binding; null when records are off, which read none. */
  readonly assignment: {
    readonly provider: ProviderId;
    readonly model: string;
    readonly effort: string;
  } | null;
  /** The phase commit noted in its status, or undefined when none is noted. */
  readonly sourceSha: string | undefined;
}

// The record's stop as a closed stop's files recorded it: its status `stop`
// and its interactive-session.json, whose transcripts the close set.
function readClosedStop(
  phaseFolderPath: string,
  phaseId: string,
): Effect.Effect<NonNullable<RecordStop>, FsError, FileSystem> {
  return Effect.gen(function* () {
    const status = yield* readPhaseStatus(phaseFolderPath);
    const session = yield* readInteractiveSession(phaseFolderPath);
    const stop = recordStopFromPersisted(status.stop, session);
    if (Either.isLeft(stop)) {
      return yield* Effect.fail(
        new FsError({ message: `Cannot record the stop of ${phaseId}: ${stop.left}` }),
      );
    }
    return stop.right;
  });
}

/** A stop this invocation closed, for the CLI to print; its report says the cause. */
export interface ClosedStop {
  readonly phaseId: string;
  readonly phaseTitle: string;
  readonly report: CloseReport;
}

// The phase request file `phax brief` reads its phase from (spec §5.13). A
// write failure is a warning: a brief never blocks the phase.
function writeBriefRequestOrWarn(
  worktreePath: string,
  phaseId: string,
  request: BriefRequestFile,
): Effect.Effect<void, never, FileSystem> {
  return writePhaseBriefRequest(worktreePath, request).pipe(
    Effect.catchAll((e) =>
      Effect.sync(() => {
        process.stderr.write(
          `[phax] Warning: phase "${phaseId}" — failed to write ${PHASE_BRIEF_REQUEST_FILE} (${e.message}).\n`,
        );
      }),
    ),
  );
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
  // Skill edit consent: `phax run --allow-skill-edits`, or the consent recorded
  // in run-status.json on resume. Absent means no consent, so a plan declaring
  // `.claude/skills/**` files is refused at preflight.
  readonly allowSkillEdits?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  // Repo-relative POSIX path of the plan that produced this run, supplied by the
  // caller (run.ts / resume.ts) — executePlan never derives it. When present the
  // final phase applies the plan's Approved → Completed transition on the run
  // branch (spec 27). Absent for callers with no lifecycle artifact to complete
  // (most tests); completeRunArtifacts is itself a no-op for loose paths.
  readonly planRepoRelPath?: string | undefined;
  // Skips the oracle step of the phase at `startIndex`, in this invocation,
  // when that phase's gate runs: the configured gate and its fix loop still
  // run. Never persisted and never reaches a later phase. The resume command
  // sets it after checking the phase's oracle role.
  readonly skipOracle?: boolean | undefined;
  // Called once a stop's close has finished, before its cleanup and
  // the next phase, so the caller can print the close as it happens.
  readonly onStopClosed?: ((closed: ClosedStop) => void) | undefined;
  // The phax version auto-publish names in the pull request footer; the CLI
  // reads it from package.json, executePlan never does.
  readonly phaxVersion: string;
}

export interface ExecutePlanResult {
  /** Every phase of the run that committed, across resumes (`countCompletedPhases`). */
  readonly completedPhaseCount: number;
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
  | GateStepRefusedError
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
  | SkillEditConsentError
  | ModelPreflightError
  | PlanSectionsPreflightError
  | AssignmentPreflightError
  | InteractivePreflightError
  | OraclePreflightError
  | OracleCommitMissingError
  | PhaseHadNoChangesError
  | RecordsDestinationRefusedError
  | RecordsSyncRequiredError
  | AwaitingReviewStopError
  | StopCloseRefusedError
  | HoldPointPausedError
  | StopRecordPausedError
  | InvalidTransitionError;

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
    allowSkillEdits = false,
    skipOracle = false,
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
  // A stop's close is running, held or declared: its failures past the
  // commit leave the run for a resume to finish, never as RunFailed.
  let closeInFlight = false;
  // A resume is reading what its start phase's re-entry needs, before
  // RunResumeRequested: a failure there leaves the run's state as it was, so
  // an interrupted run stays resumable instead of becoming failed.
  let reentryReading = false;

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
    readonly mode: PhaseMode;
    readonly stop: RecordStop;
    readonly usage: RecordUsageSource;
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
        oracle: recordOracleRole(oracleRoleOf(plan.phases, args.phaseId)),
        mode: args.mode,
        stop: args.stop,
        // A session's usage reads a vibe session under the ProviderStoreRoots
        // vibe root the run's layer provides.
        usage: args.usage,
        records: config.records,
        ...(config.records.destination.kind === "repo"
          ? { recordsClonePath: recordsClonePath(config.stateRoot, namespace) }
          : {}),
        ...(args.sourceSha !== undefined ? { sourceSha: args.sourceSha } : {}),
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

  // The record a closed stop owes, declared or held, written once from what
  // the close reported or what was read before RunResumeRequested. A refused
  // destination is the headless record policy, made resumable: the close
  // stands, so StopRecordRefused pauses the run with the record still owed,
  // which the closed stop's re-entry writes once. A failure of that dispatch
  // still ends in the pause. Traced as the `stop.record` step when records
  // are configured.
  function writeStopRecord(args: {
    readonly phase: PhaxPlanPhase;
    readonly phaseFolderPath: string;
    readonly worktreePath: WorktreePath;
    readonly inputs: StopRecordInputs;
    /** The declared commit, or a held phase's own commit (never its review commit). */
    readonly sourceSha: string;
    readonly stop: NonNullable<RecordStop>;
  }): Effect.Effect<
    void,
    StopRecordPausedError,
    Git | FileSystem | GitHub | Shell | SystemTelemetry
  > {
    const { phase, inputs } = args;
    const write = writeRecordForPhase({
      phaseId: phase.id,
      phaseFolderPath: args.phaseFolderPath,
      provider: inputs.provider,
      model: inputs.model,
      effort: inputs.effort,
      mode: phase.mode,
      stop: args.stop,
      usage: inputs.usage,
      outcome: "committed",
      sourceSha: args.sourceSha,
    }).pipe(
      Effect.catchAll((refused) =>
        Effect.gen(function* () {
          yield* dispatch(
            {
              ...eventBase(phase.id),
              type: "StopRecordRefused",
              phaseId: phase.id as PhaseId,
              cause: args.stop.cause,
              phaseCommit: args.sourceSha,
              worktreePath: args.worktreePath,
              reason: refused.message,
            },
            dispatchCtx(args.phaseFolderPath, phase.id),
          ).pipe(Effect.catchAll(() => Effect.void));
          return yield* Effect.fail(
            new StopRecordPausedError({
              message: refused.message,
              phaseId: phase.id,
              cause: refused,
            }),
          );
        }),
      ),
    );
    if (!config.records.enabled) return write;
    return tracedStep({ runId, phaseId: phase.id, step: "stop.record" }, write, () => true);
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
      isGateStepRefusedError(e) ||
      isHandoffPausedError(e) ||
      isCommitPausedError(e) ||
      isCleanupPausedError(e) ||
      isArtifactCompletionPausedError(e) ||
      isHoldPointPausedError(e) ||
      isStopRecordPausedError(e) ||
      isReviewStopError(e)
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

  // The phase facts, one builder for the gate request and the brief request:
  // the base noted in status.json when phax created the branch (never
  // re-derived from git), the terminal flag and the plan's projection.
  function phaseFactsFor(
    phaseFolderPath: string,
    phaseId: string,
    isFinal: boolean,
  ): Effect.Effect<GateRequest, FsError, FileSystem> {
    return readPhaseBase(phaseFolderPath).pipe(
      Effect.map((base) =>
        makeGateRequest({ phaseId, base, terminal: isFinal, phases: plan.phases }),
      ),
    );
  }

  // The oracle step of a phase in an oracle pair, or undefined for any other
  // phase. Its request is built from the oracle phase's status.json facts
  // only, never from git, on every phase entry, so a resume, a reset or a
  // re-run names the oracle phase's current base and commit. The oracles
  // command runs only from phax: it is in no grant, frozen command set or
  // prompt list.
  function oracleStepFor(
    phaseFolderPath: string,
    phaseId: string,
    skip: boolean,
  ): Effect.Effect<
    OracleStep | undefined,
    FsError | OraclePreflightError | OracleCommitMissingError,
    FileSystem
  > {
    return Effect.gen(function* () {
      const role = oracleRoleOf(plan.phases, phaseId);
      if (role === null) return undefined;
      if (config.oracles === undefined) {
        // The preflight refuses this plan; never skip the step.
        const planPath = join(runPath, "plan.md");
        const findings = oracleFindings({
          headers: readPhaseHeaders(planMd),
          phases: plan.phases,
          providerConfigured: false,
        });
        return yield* Effect.fail(
          new OraclePreflightError({
            message: [
              `Oracle preflight failed: ${findings.length} error(s).`,
              ...findings.map((f) => `  ${f.phase ?? "-"}  ${f.message}`),
              `Fix the plan, then check it with \`phax plans lint ${planPath}\`.`,
            ].join("\n"),
            findings,
            planPath,
          }),
        );
      }
      const oracleFolder =
        role.role === "oracle" ? phaseFolderPath : join(runPath, role.pair.oraclePhase);
      if (skip) return { kind: "skipped", command: config.oracles.command };
      const base = yield* readPhaseBase(oracleFolder);
      const oracleCommit = role.role === "oracle" ? null : yield* oracleCommitOf(role.pair);
      return {
        kind: "run",
        command: config.oracles.command,
        request: serializeOracleRequest(makeOracleRequest({ role, phaseId, base, oracleCommit })),
        timeoutMs: ORACLE_PROVIDER_TIMEOUT_MS,
      };
    });
  }

  // The commit a discharging phase judges, from status.json facts only: the
  // latest commit of the pair that passed `authored` (a closed stop's that ran
  // the step, or else the oracle phase's own). An oracle phase that noted no
  // commit was skipped for producing no changes, so there is nothing to
  // discharge, and no resume can change that.
  function oracleCommitOf(
    pair: OraclePair,
  ): Effect.Effect<string, FsError | OracleCommitMissingError, FileSystem> {
    return Effect.gen(function* () {
      const from = plan.phases.findIndex((p) => p.id === pair.oraclePhase);
      const to = plan.phases.findIndex((p) => p.id === pair.dischargingPhase);
      // A phase of the pair a reset archived, or one not entered, has no status.
      const statuses = yield* Effect.forEach(plan.phases.slice(from, to), (p) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const folder = join(runPath, p.id);
          if (!(yield* fs.exists(join(folder, "status.json")))) return [];
          return [yield* readPhaseStatus(folder)];
        }),
      );
      // Read through readPhaseCommit, which refuses a noted hash that is not a full name.
      const noted = yield* readPhaseCommit(join(runPath, pair.oraclePhase));
      const latest = latestAuthoredCommit(pair, plan.phases, statuses.flat());
      if (noted.commit !== null && latest !== null) return latest;
      return yield* Effect.fail(
        new OracleCommitMissingError({
          message: [
            `Cannot run discharging phase "${pair.dischargingPhase}" of run "${shortName}": its oracle phase "${pair.oraclePhase}" is ${noted.state} and noted no commit, so there are no oracles to discharge.`,
            `No resume gives a skipped oracle phase a commit: archive the run (phax archive ${shortName} --force) and run a corrected plan whose oracle phase writes its oracles.`,
          ].join("\n"),
          oraclePhase: pair.oraclePhase,
          dischargingPhase: pair.dischargingPhase,
        }),
      );
    });
  }

  // The model resolution and the security posture of a phase entered fresh,
  // headless or interactive: writes model-resolution.json and security.json,
  // which an interactive phase's later turns read.
  function resolvePhaseAgent(args: {
    readonly phase: PhaxPlanPhase;
    readonly worktreePath: string;
    readonly phaseFolderPath: string;
    readonly gateCommands: readonly string[];
    readonly briefCommands: readonly string[];
    readonly skillEditGrants: readonly string[];
  }) {
    return Effect.gen(function* () {
      const telemetry = yield* SystemTelemetry;
      const fs = yield* FileSystem;
      const { phase, phaseFolderPath } = args;
      // The resolved policy is provider-independent (filesystem/network/mcp
      // come from config + worktree, not the provider), so compute it once
      // and reuse it for both the routing security filter and the selected
      // run.
      const securityPolicy = resolveSecurityPolicy({
        mode: securityMode,
        worktreePath: args.worktreePath,
        config: config.security,
      });
      const resolution = resolveModel(
        { model: phase.model, effort: phase.effort },
        routing,
        providerConfig,
        securityFilterFor(securityPolicy),
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
        gateCommands: args.gateCommands,
        briefCommands: args.briefCommands,
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
        version: 2,
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
        skillEditGrants: [...args.skillEditGrants],
        providerSkippedForSecurity: resolution.skippedForSecurity ?? [],
        stop: null,
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
      return { resolution, securityPolicy, frozenResult };
    });
  }

  // cleanupPhase dispatches CleanupStarted/CleanupCompleted internally.
  // If cleanup fails (dirty worktree, setup command failure, git error), dispatch
  // CleanupFailed to pause the run as `interrupted` with the phase in `cleaning_up`,
  // then re-raise as CleanupPausedError so the top-level guard skips RunFailed.
  function cleanupCommittedPhase(args: {
    readonly phase: PhaxPlanPhase;
    readonly worktreePath: WorktreePath;
    readonly phaseFolderPath: string;
    readonly cleanupCommands: readonly string[];
  }) {
    const { phase, worktreePath, phaseFolderPath } = args;
    return cleanupPhase({
      worktreePath,
      phaseFolderPath,
      cleanupCommands: args.cleanupCommands,
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
            dispatchCtx(phaseFolderPath, phase.id),
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

  // The closed stops before phase `i`, read from disk so a resumed run sees
  // the stops an earlier invocation closed. Chosen by each phase's status
  // `stop`, never by its mode. A run with no phase before `i` that could have
  // stopped (declared, or in the run's hold) reads nothing, so its prompts
  // stay as they were.
  function reviewCorrectionsFor(i: number, hold: RunHold) {
    return Effect.gen(function* () {
      if (
        !plan.phases.slice(0, i).some((p) => p.mode === "interactive" || holdsPhase(hold, p.id))
      ) {
        return [];
      }
      const infoResult = resolveRun(namespace, shortName, config.stateRoot);
      if (Either.isLeft(infoResult)) {
        return yield* Effect.fail(
          new RegistryCorruptionError({
            message: `Failed to resolve run "${shortName}" for its review corrections: ${infoResult.left}`,
            registryPath: join(config.stateRoot, "registry.json"),
          }),
        );
      }
      return yield* readReviewCorrections(runPath, plan.phases, i, infoResult.right.phaseStatuses);
    });
  }

  // What the record of a held phase needs, read from the phase's own files and
  // never from HEAD: the builder's binding, the phase commit and the builder's
  // usage recorded at the hold point; on a closed stop's re-entry, its stop.
  function readHeldRecord(
    phaseFolderPath: string,
    phaseId: string,
    closed: boolean,
  ): Effect.Effect<StopRecordInputs, FsError | RegistryCorruptionError, FileSystem> {
    return Effect.gen(function* () {
      const binding = yield* Effect.promise(() => readAgentBinding(phaseFolderPath));
      if (Either.isLeft(binding)) {
        return yield* Effect.fail(
          new RegistryCorruptionError({
            message: `Cannot resume phase "${phaseId}" of run "${shortName}": agent-binding.json is missing or unreadable (${binding.left}).`,
            registryPath: join(phaseFolderPath, "agent-binding.json"),
          }),
        );
      }
      const { commit } = yield* readPhaseCommit(phaseFolderPath);
      if (commit === null) {
        return yield* Effect.fail(
          new FsError({ message: `${phaseId} is held but noted no commit in its status` }),
        );
      }
      // Records off owe no record: the session is not read for its usage. A
      // close that found no interactive-session.json writes one with no
      // builder usage, so the record then names none rather than leave the
      // stop unresumable.
      const session = config.records.enabled
        ? yield* readInteractiveSession(phaseFolderPath)
        : null;
      const usage: RecordUsageSource =
        session === null || session.builderUsage === null
          ? { kind: "none" }
          : { kind: "recorded", usage: session.builderUsage };
      return {
        provider: binding.right.provider,
        model: binding.right.model,
        effort: binding.right.effort,
        usage,
        sourceSha: commit,
        closedStop: closed ? yield* readClosedStop(phaseFolderPath, phaseId) : undefined,
      };
    });
  }

  // What the record of a declared phase needs: its routed assignment, with
  // the effort the close computes (`model.effort ?? phase.effort`); on a
  // closed stop's re-entry, the declared commit and its stop. No agent
  // session built the phase, so its record names no usage.
  function readDeclaredRecord(
    phaseFolderPath: string,
    phase: PhaxPlanPhase,
    closed: boolean,
  ): Effect.Effect<StopRecordInputs, FsError, FileSystem> {
    return Effect.gen(function* () {
      const model = yield* readModelResolution(phaseFolderPath);
      const assignment = {
        provider: model.provider,
        model: model.model,
        effort: model.effort ?? phase.effort,
        usage: { kind: "none" } as const,
      };
      if (!closed) return { ...assignment, sourceSha: undefined, closedStop: undefined };
      const { commit } = yield* readPhaseCommit(phaseFolderPath);
      if (commit === null) {
        return yield* Effect.fail(
          new FsError({ message: `${phase.id} closed its stop but noted no commit in its status` }),
        );
      }
      return {
        ...assignment,
        sourceSha: commit,
        closedStop: yield* readClosedStop(phaseFolderPath, phase.id),
      };
    });
  }

  // What a committed phase owes after its valid handoff needs, read from its
  // own files: the commit noted in its status (never HEAD) and, when records
  // are on, the builder's binding. Its worktree is checked, not required: a gone
  // one has nothing left for the cleanup to clean.
  function readPostHandoffInputs(
    phaseFolderPath: string,
    phaseId: string,
    worktreePath: string | undefined,
  ): Effect.Effect<
    PostHandoffInputs,
    FsError | RegistryCorruptionError | UnsafeGitStateError | WorktreeCreationError,
    FileSystem
  > {
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const branchStr = `${plan.run.branch}--${phaseId}`;
      const phaseBranch = decodeBranchName(branchStr);
      if (Either.isLeft(phaseBranch)) {
        return yield* Effect.fail(
          new UnsafeGitStateError({
            message: `Invalid phase branch "${branchStr}"`,
            repoPath: config.repoRoot,
          }),
        );
      }
      let worktree: WorktreePath | null = null;
      if (worktreePath !== undefined && (yield* fs.exists(worktreePath))) {
        const decoded = decodeWorktreePath(worktreePath);
        if (Either.isLeft(decoded)) {
          return yield* Effect.fail(
            new WorktreeCreationError({
              message: `Invalid worktree path "${worktreePath}"`,
              branch: phaseBranch.right,
              path: worktreePath,
            }),
          );
        }
        worktree = decoded.right;
      }
      let assignment: PostHandoffInputs["assignment"] = null;
      if (config.records.enabled) {
        const binding = yield* Effect.promise(() => readAgentBinding(phaseFolderPath));
        if (Either.isLeft(binding)) {
          return yield* Effect.fail(
            new RegistryCorruptionError({
              message: `Cannot resume phase "${phaseId}" of run "${shortName}": agent-binding.json is missing or unreadable (${binding.left}).`,
              registryPath: join(phaseFolderPath, "agent-binding.json"),
            }),
          );
        }
        const { provider, model, effort } = binding.right;
        assignment = { provider, model, effort };
      }
      // A back-reference only, as the committed path's HEAD lookup is.
      const { commitHash } = yield* readPhaseStatus(phaseFolderPath);
      return { branch: phaseBranch.right, worktree, assignment, sourceSha: commitHash };
    });
  }

  // Whether the records branch already holds a phase record of this run's
  // phase. A listing failure fails before RunResumeRequested.
  function phaseRecordExists(phaseId: string) {
    return listRecords({
      records: config.records,
      repoRoot: config.repoRoot,
      publishRemote: config.publish.remote,
      ...(config.records.destination.kind === "repo"
        ? { recordsClonePath: recordsClonePath(config.stateRoot, namespace) }
        : {}),
      runId: runId as string,
    }).pipe(
      Effect.map(
        (listed) =>
          listed.kind === "listed" &&
          listed.records.some((r) => r.kind === "phase" && r.phaseId === phaseId),
      ),
    );
  }

  const program = Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;
    const git = yield* Git;
    // The hold recorded when the run was named: every invocation holds
    // exactly these phases, and no caller passes another.
    const hold = yield* readRunHold(runPath);

    yield* telemetry.recordEvent(makeStepStartedTelemetryEvent({ runId, step: "config.discover" }));
    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({ runId, step: "config.validate", result: "success" }),
    );

    // A new check that does not need the run belongs in runPreflights, not inline here.
    const { gateSteps, planSections } = yield* runPreflights({
      plan,
      planMd,
      planPath: join(runPath, "plan.md"),
      config,
      gateProfileId,
      workspaceId,
      namespace,
      routing,
      providerConfig,
      allowSkillEdits,
      startIndex,
    });
    const gateCommandStrings = gateSteps.map((s) => s.command);
    // A configured brief provider grants the in-phase agent `phax brief`.
    const briefCommands = config.brief !== undefined ? ["phax brief"] : [];

    let branch: BranchName;
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
    // A non-final committed phase outside the hold whose handoff is valid but
    // whose cleanup never started: a person wrote its handoff by hand after
    // its handoff turn was cut short, or an interrupt came between the handoff
    // and the cleanup. Only its briefs, its record (when owed) and its cleanup
    // run.
    let resumeAfterHandoff = false;
    // An interactive phase awaiting review: the resume closes its stop.
    let resumeFromStop = false;
    // A headless phase awaiting review: a held stop, closed by this resume.
    let resumeFromHeldStop = false;
    // A non-final phase whose stop is closed but whose cleanup is not done, and
    // the cause of that stop.
    let resumeFromClosedStop = false;
    let resumeClosedCause: "declared" | "held" | undefined;
    // A held phase whose stop is still owed, committed or handoff_failed, with
    // its handoff already validated and copied. It re-enters the hold point
    // with no agent turn, gate, commit or handoff turn. Without a valid copy
    // (a committed phase interrupted during its handoff turn, or a failed
    // handoff) it takes the handoff re-entry and stops once the handoff passes.
    let resumeAtHoldPoint = false;
    let resumeSessionId: string | undefined;
    let resumeWorktreePath: string | undefined;
    reentryReading = true;
    if (resumePhase !== undefined) {
      const infoResult = resolveRun(namespace, shortName, config.stateRoot);
      if (Either.isRight(infoResult)) {
        const phaseStatus = infoResult.right.phaseStatuses.find(
          (p) => p.phaseId === resumePhase.id,
        );
        const owesHeldStop =
          phaseStatus !== undefined &&
          phaseStatus.stop === null &&
          startIndex < plan.phases.length - 1 &&
          holdsPhase(hold, resumePhase.id);
        if (phaseStatus?.state === "gates_exhausted") {
          resumeFromGate = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (
          phaseStatus !== undefined &&
          owesHeldStop &&
          (phaseStatus.state === "committed" || phaseStatus.state === "handoff_failed") &&
          resumePhaseFolderPath !== undefined &&
          (yield* committedHandoffIsValid(resumePhaseFolderPath))
        ) {
          resumeAtHoldPoint = true;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (
          phaseStatus?.state === "handoff_failed" ||
          (owesHeldStop && phaseStatus?.state === "committed")
        ) {
          // A held phase committed before its handoff was copied (interrupted
          // during the handoff turn) re-runs only the handoff, as a failed one.
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
        } else if (
          phaseStatus?.state === "committed" &&
          phaseStatus.stop === null &&
          resumePhaseFolderPath !== undefined &&
          !(yield* committedHandoffIsValid(resumePhaseFolderPath))
        ) {
          // A limit inside the handoff turn leaves the run running and the
          // phase committed with no valid handoff, final or not: it owes the
          // handoff, and re-runs only that turn before going on.
          resumeFromHandoff = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (
          phaseStatus?.state === "committed" &&
          phaseStatus.stop === null &&
          startIndex < plan.phases.length - 1
        ) {
          // Its handoff is valid (the branch above took an invalid one) and
          // it is outside the hold (a held one re-enters its hold point).
          // Every such phase goes on to its cleanup in the invocation that
          // validates its handoff, so only what follows the handoff is owed:
          // a handoff written by hand, or an interrupt before the cleanup.
          resumeAfterHandoff = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (phaseStatus?.state === "committed" && startIndex === plan.phases.length - 1) {
          // A `committed` final phase (its handoff valid) means the run paused at artifact completion
          // (ArtifactCompletionFailed): commit/handoff already landed, only the
          // completion step remains. `committed` is transient for non-final
          // phases (they pause as `cleaning_up`), so the final-phase guard is what
          // distinguishes this re-entry.
          resumeFromCompletion = true;
          resumeSessionId = phaseStatus.claudeSessionId;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (
          phaseStatus?.state === "committed" &&
          phaseStatus.stop?.status === "closed" &&
          startIndex < plan.phases.length - 1
        ) {
          // A close that dispatched its state event and was interrupted before
          // its cleanup: only what it still owes (a held stop's record, then
          // the cleanup) runs.
          resumeFromClosedStop = true;
          resumeClosedCause = phaseStatus.stop.cause;
          resumeWorktreePath = phaseStatus.worktreePath;
        } else if (phaseStatus?.state === "awaiting_review") {
          // Read before RunResumeRequested parks review-stop.json. A crashed
          // close left the run `running`, its phase still awaiting_review, so
          // it re-enters here too. A headless phase's stop is a held one.
          if (resumePhase.mode === "headless") resumeFromHeldStop = true;
          else resumeFromStop = true;
          resumeWorktreePath = phaseStatus.worktreePath;
        }
      }
    }

    // A stop's or a hold point's re-entry: only its recorded worktree is
    // needed; an interactive phase has no claudeSessionId and no
    // agent-binding.json, and a hold point runs no session. Fails, with
    // nothing changed, when the worktree is gone or a name does not decode.
    function interactiveReentry(
      phaseId: string,
      worktreePath: string | undefined,
    ): Effect.Effect<
      { readonly branch: BranchName; readonly worktree: WorktreePath },
      WorktreeCreationError | UnsafeGitStateError
    > {
      return Effect.gen(function* () {
        if (worktreePath === undefined || !existsSync(worktreePath)) {
          return yield* Effect.fail(
            new WorktreeCreationError({
              message: `Cannot resume phase "${phaseId}" of run "${shortName}": worktree "${worktreePath ?? "<unknown>"}" no longer exists`,
              branch,
              path: worktreePath ?? "",
            }),
          );
        }
        const branchStr = `${plan.run.branch}--${phaseId}`;
        const phaseBranch = decodeBranchName(branchStr);
        if (Either.isLeft(phaseBranch)) {
          return yield* Effect.fail(
            new UnsafeGitStateError({
              message: `Invalid phase branch "${branchStr}"`,
              repoPath: config.repoRoot,
            }),
          );
        }
        const worktree = decodeWorktreePath(worktreePath);
        if (Either.isLeft(worktree)) {
          return yield* Effect.fail(
            new WorktreeCreationError({
              message: `Invalid worktree path "${worktreePath}"`,
              branch: phaseBranch.right,
              path: worktreePath,
            }),
          );
        }
        return { branch: phaseBranch.right, worktree: worktree.right };
      });
    }

    // The hold point of a non-final headless phase of the run's hold: after
    // its commit, its validated handoff and its pulled briefs, before its
    // record and its cleanup. It stops the run there with no agent turn, and
    // returns only when the phase's stop is already recorded. Any failure
    // before ReviewStopReached dispatches HoldPointFailed (the run interrupted,
    // the phase committed) and pauses as HoldPointPausedError: no record, no
    // RunFailed.
    function holdPoint(args: {
      readonly phase: PhaxPlanPhase;
      readonly phaseIndex: number;
      readonly phaseFolderPath: string;
      readonly worktreePath: WorktreePath;
    }) {
      const { phase, phaseFolderPath, worktreePath } = args;
      let phaseCommit: string | undefined;
      const reach = Effect.gen(function* () {
        const status = yield* readPhaseStatus(phaseFolderPath);
        if (status.stop !== null) return null;
        phaseCommit = status.commitHash;
        if (phaseCommit === undefined) {
          return yield* Effect.fail(
            new FsError({ message: `${phase.id} is held but noted no commit in its status` }),
          );
        }
        const binding = yield* Effect.promise(() => readAgentBinding(phaseFolderPath));
        if (Either.isLeft(binding)) {
          return yield* Effect.fail(new FsError({ message: binding.left }));
        }
        const { provider, model, effort, sessionId } = binding.right;
        const posture = yield* readPhasePosture(phaseFolderPath);
        return yield* stopAtHeldPhase({
          runId,
          shortName: shortName as string,
          runPath,
          mainCheckout: config.repoRoot,
          phases: plan.phases,
          phase,
          phaseIndex: args.phaseIndex,
          phaseFolder: phaseFolderPath,
          worktree: worktreePath as string,
          provider,
          model,
          effort,
          providerEntry: providerConfig.providers[provider],
          policy: posture.policy,
          agentCommands: posture.agentCommands,
          gateCommands: selectGateSteps(gateSteps, false).map((s) => s.command),
          planSections: planSections.sections,
          base: status.base,
          phaseCommit,
          builder: sessionId === null ? null : { sessionId, startedAt: status.createdAt },
        });
      });
      return reach.pipe(
        Effect.catchAll((e) =>
          Effect.gen(function* () {
            const reason = e instanceof Error ? e.message : String(e);
            yield* dispatch(
              {
                ...eventBase(phase.id),
                type: "HoldPointFailed",
                phaseId: phase.id as PhaseId,
                // Not persisted: the status keeps its own commitHash. Unknown
                // only when the status itself could not be read.
                phaseCommit: phaseCommit ?? "",
                worktreePath,
                reason,
              },
              dispatchCtx(phaseFolderPath, phase.id),
            ).pipe(Effect.catchAll(() => Effect.void));
            return yield* Effect.fail(
              new HoldPointPausedError({
                message: `Hold point failed for phase "${phase.id}": ${reason}`,
                phaseId: phase.id,
                cause: e,
              }),
            );
          }),
        ),
        Effect.flatMap((report) =>
          report === null
            ? Effect.void
            : Effect.fail(
                new AwaitingReviewStopError({
                  message: `Run "${shortName}" awaits review at ${phase.id} (held: --hold)`,
                  run: shortName as string,
                  phase: phase.id,
                  report,
                }),
              ),
        ),
      );
    }

    // A stop's worktree is checked before RunResumeRequested, so a stop whose
    // worktree is gone is refused with the run still awaiting review.
    const stopReentry =
      (resumeFromStop || resumeFromHeldStop || resumeFromClosedStop) && resumePhase !== undefined
        ? yield* interactiveReentry(resumePhase.id, resumeWorktreePath)
        : undefined;
    // What a stop's record needs is read now, before RunResumeRequested, for
    // either cause, so a failure changes nothing and nothing is read after
    // the close.
    const stopCause: "declared" | "held" | undefined = resumeFromStop
      ? "declared"
      : resumeFromHeldStop
        ? "held"
        : resumeFromClosedStop
          ? resumeClosedCause
          : undefined;
    // A closed stop owes its record only when none is on the records branch
    // yet, which is listed now for the same reason; only then is its stop
    // read back from its files.
    const closedStopOwesRecord =
      resumeFromClosedStop && config.records.enabled && resumePhaseId !== undefined
        ? !(yield* phaseRecordExists(resumePhaseId))
        : false;
    const stopRecordInputs =
      stopCause !== undefined && resumePhase !== undefined && resumePhaseFolderPath !== undefined
        ? stopCause === "held"
          ? yield* readHeldRecord(resumePhaseFolderPath, resumePhase.id, closedStopOwesRecord)
          : yield* readDeclaredRecord(resumePhaseFolderPath, resumePhase, closedStopOwesRecord)
        : undefined;
    // So is a hold point's: its worktree and branch must still be there.
    const holdPointReentry =
      resumeAtHoldPoint && resumePhase !== undefined
        ? yield* interactiveReentry(resumePhase.id, resumeWorktreePath)
        : undefined;
    // So is what follows a valid handoff, its record owed only when none is
    // on the records branch yet: an interrupt may have come after it.
    const postHandoffInputs =
      resumeAfterHandoff && resumePhase !== undefined && resumePhaseFolderPath !== undefined
        ? yield* readPostHandoffInputs(resumePhaseFolderPath, resumePhase.id, resumeWorktreePath)
        : undefined;
    const postHandoffOwesRecord =
      resumeAfterHandoff && config.records.enabled && resumePhaseId !== undefined
        ? !(yield* phaseRecordExists(resumePhaseId))
        : false;
    reentryReading = false;

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

    let finalWorktreePath: WorktreePath | undefined;
    let finalPhaseId: string | undefined;
    // The phase statuses read for the final review, before it opened.
    let finalReviewStatuses: readonly PhaseStatus[] = [];
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
      // A discharging phase judges its oracle phase's commit: refuse before
      // anything of the phase runs when the oracle phase noted none.
      // A stop's re-entry, a closed stop's and a hold point's skip it: that
      // phase's gate already ran.
      const gateAlreadyRan =
        i === startIndex &&
        (resumeFromStop ||
          resumeFromHeldStop ||
          resumeFromClosedStop ||
          resumeAtHoldPoint ||
          resumeAfterHandoff);
      const phaseOracleRole = oracleRoleOf(plan.phases, phase.id);
      if (phaseOracleRole?.role === "discharging" && !gateAlreadyRan) {
        yield* oracleCommitOf(phaseOracleRole.pair);
      }
      // The preflight already refused skill-declaring phases without consent,
      // so the `[]` branch is defense in depth only.
      const skillEditGrants = allowSkillEdits ? phaseSkillEditGrants(phase) : [];

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

      if (phase.mode === "interactive") {
        // A phase no agent builds: no work session, gate, fix loop or handoff
        // turn. Entered fresh, it stops after a read-only first turn; a resume
        // closes the stop, writes its record, runs the cleanup and goes on.
        currentPhaseId = phase.id;
        currentWorktreePath = undefined;
        currentSessionId = undefined;
        currentProvider = undefined;
        currentModel = undefined;
        currentEffort = undefined;
        const isResumeFromStop = i === startIndex && resumeFromStop;
        const isResumeFromClosedStop = i === startIndex && resumeFromClosedStop;

        if (isResumeFromStop || isResumeFromClosedStop || isResumeFromCleanup) {
          // A stop's and a closed stop's re-entry were checked before
          // RunResumeRequested.
          const reentry =
            isResumeFromStop || isResumeFromClosedStop
              ? stopReentry
              : yield* interactiveReentry(phase.id, resumeWorktreePath);
          if (reentry === undefined) {
            return yield* Effect.dieMessage(`No checked re-entry for the stop at ${phase.id}`);
          }
          const reentryBranch = reentry.branch;
          const reentryWorktree = reentry.worktree;
          const stopFolder = join(runPath, phase.id);
          currentPhaseFolderPath = stopFolder;
          currentWorktreePath = reentryWorktree as string;

          // What the record needs was read before RunResumeRequested; a
          // cleanup re-entry writes no record.
          const declaredRecord = isResumeFromCleanup ? undefined : stopRecordInputs;
          if (!isResumeFromCleanup && declaredRecord === undefined) {
            return yield* Effect.dieMessage(`No record inputs for the stop at ${phase.id}`);
          }
          if (isResumeFromStop) {
            // A failure of the close past its commit leaves the run for a
            // resume to finish: it is never a RunFailed.
            closeInFlight = true;
            const report = yield* closeStop({
              runId,
              shortName: shortName as string,
              runPath,
              phase,
              phaseFolder: stopFolder,
              worktree: reentryWorktree as string,
              gateSteps,
              gateRequest: phaseFactsFor(stopFolder, phase.id, false).pipe(
                Effect.map(serializeGateRequest),
              ),
              fileReconciliationMode: config.fileReconciliationMode,
              phases: plan.phases,
              oracles: config.oracles ?? null,
              mainCheckout: config.repoRoot,
            });
            closeInFlight = false;
            opts.onStopClosed?.({ phaseId: phase.id, phaseTitle: phase.title, report });
            if (report.cause !== "declared" || declaredRecord === undefined) {
              return yield* Effect.dieMessage(`The stop at ${phase.id} did not close as declared`);
            }
            yield* writeStopRecord({
              phase,
              phaseFolderPath: stopFolder,
              worktreePath: reentryWorktree,
              inputs: declaredRecord,
              sourceSha: report.commit,
              stop: recordStopOf(report),
            });
          } else if (isResumeFromClosedStop && closedStopOwesRecord) {
            if (
              declaredRecord?.sourceSha === undefined ||
              declaredRecord.closedStop === undefined
            ) {
              return yield* Effect.dieMessage(
                `No recorded stop for the closed stop at ${phase.id}`,
              );
            }
            yield* writeStopRecord({
              phase,
              phaseFolderPath: stopFolder,
              worktreePath: reentryWorktree,
              inputs: declaredRecord,
              sourceSha: declaredRecord.sourceSha,
              stop: declaredRecord.closedStop,
            });
          }
          // The lint keeps an interactive phase off the last place, so it
          // always has a cleanup.
          yield* cleanupCommittedPhase({
            phase,
            worktreePath: reentryWorktree,
            phaseFolderPath: stopFolder,
            cleanupCommands,
          });
          previousPhaseBranch = reentryBranch;
          continue;
        }

        const preparedStopBranch = yield* preparePhaseBranch(
          branch,
          phaseIdResult.right,
          previousPhaseBranch,
          config.repoRoot,
        );
        const stopFolder = yield* createPhaseFolder(
          runPath,
          phase,
          i,
          preparedStopBranch,
          config.repoRoot,
        );
        currentPhaseFolderPath = stopFolder;
        const stopCtx = dispatchCtx(stopFolder, phase.id);
        yield* dispatch(
          { ...eventBase(phase.id), type: "PhaseStartRequested", phaseId: phase.id as PhaseId },
          stopCtx,
        );
        const stopWorktree = yield* createPhaseWorktree(
          namespace,
          shortName,
          phaseIdResult.right,
          preparedStopBranch.branch,
          config.stateRoot,
          config.repoRoot,
        );
        currentWorktreePath = stopWorktree as string;
        yield* recordPhaseWorktreeAndBranch(stopFolder, stopWorktree, preparedStopBranch.branch);
        yield* telemetry.recordEvent(
          makeAdapterCallSucceededTelemetryEvent({
            runId,
            operationId: phase.id,
            adapter: "git",
            operation: "worktree.create",
          }),
        );
        yield* dispatch(
          { ...eventBase(phase.id), type: "WorktreeCreated", path: stopWorktree },
          stopCtx,
        );
        yield* setupPhase({
          worktreePath: stopWorktree,
          phaseFolderPath: stopFolder,
          setupCommands,
        });
        yield* writePhasePlanFile(stopWorktree as string, planMd);

        const { resolution, securityPolicy, frozenResult } = yield* resolvePhaseAgent({
          phase,
          worktreePath: stopWorktree as string,
          phaseFolderPath: stopFolder,
          gateCommands: gateCommandStrings,
          briefCommands,
          skillEditGrants,
        });

        const executedHandoffs = yield* readExecutedHandoffs(runPath, plan.phases, i);
        const report = yield* stopAtDeclaredPhase({
          runId,
          shortName: shortName as string,
          runPath,
          mainCheckout: config.repoRoot,
          phases: plan.phases,
          phase,
          phaseIndex: i,
          phaseFolder: stopFolder,
          worktree: stopWorktree as string,
          provider: resolution.selected.provider,
          model: resolution.selected.concreteModel,
          effort: resolution.selected.thinking ?? phase.effort,
          providerEntry: providerConfig.providers[resolution.selected.provider],
          policy: securityPolicy,
          agentCommands: frozenResult.records.map((r) => r.command),
          gateCommands: selectGateSteps(gateSteps, false).map((s) => s.command),
          planSections: planSections.sections,
          executedHandoffs,
        });
        return yield* Effect.fail(
          new AwaitingReviewStopError({
            message: `Run "${shortName}" awaits review at ${phase.id} (declared: interactive phase)`,
            run: shortName as string,
            phase: phase.id,
            report,
          }),
        );
      }

      if (i === startIndex && resumeAtHoldPoint) {
        // Its worktree and branch were checked before RunResumeRequested. No
        // agent turn, gate, commit or handoff turn: straight to the hold point.
        if (holdPointReentry === undefined) {
          return yield* Effect.dieMessage(`No checked re-entry for the hold point of ${phase.id}`);
        }
        const heldFolder = join(runPath, phase.id);
        currentPhaseId = phase.id;
        currentPhaseFolderPath = heldFolder;
        currentWorktreePath = holdPointReentry.worktree as string;
        currentSessionId = undefined;
        currentProvider = undefined;
        currentModel = undefined;
        currentEffort = undefined;
        // The pulled briefs land before the hold point, as on a first entry,
        // so the record written at closing lists them. A no-op when the
        // first entry already closed them.
        if (config.brief !== undefined) {
          yield* closePulledBriefs({
            worktreePath: holdPointReentry.worktree as string,
            phaseFolderPath: heldFolder,
            phaseId: phase.id,
          });
        }
        yield* holdPoint({
          phase,
          phaseIndex: i,
          phaseFolderPath: heldFolder,
          worktreePath: holdPointReentry.worktree,
        });
        return yield* Effect.dieMessage(`The hold point of ${phase.id} owed no stop on re-entry`);
      }

      if (i === startIndex && (resumeFromHeldStop || resumeFromClosedStop)) {
        // A held stop's close, or a closed held stop's re-entry. Its worktree
        // and what its record needs were read before RunResumeRequested, and
        // nothing is read after the close: the record is written from them.
        if (stopReentry === undefined || stopRecordInputs === undefined) {
          return yield* Effect.dieMessage(`No checked re-entry for the held stop at ${phase.id}`);
        }
        const heldRecord = stopRecordInputs;
        // The phase commit, never HEAD (which is the review commit).
        const phaseCommit = heldRecord.sourceSha;
        if (phaseCommit === undefined) {
          return yield* Effect.dieMessage(`No phase commit read for the held stop at ${phase.id}`);
        }
        const heldFolder = join(runPath, phase.id);
        currentPhaseId = phase.id;
        currentPhaseFolderPath = heldFolder;
        currentWorktreePath = stopReentry.worktree as string;
        currentSessionId = undefined;
        // Left unset: no failure after the commit writes a `failed` record,
        // and the record below is passed its values explicitly.
        currentProvider = undefined;
        currentModel = undefined;
        currentEffort = undefined;

        // Its usage is the builder's at the hold point, so a closing turn
        // that grew a vibe session's meta.json is not counted.
        const writeHeldRecord = (stop: NonNullable<RecordStop>) =>
          writeStopRecord({
            phase,
            phaseFolderPath: heldFolder,
            worktreePath: stopReentry.worktree,
            inputs: heldRecord,
            sourceSha: phaseCommit,
            stop,
          });

        if (resumeFromHeldStop) {
          // A failure of the close past its commit leaves the run for a
          // resume to finish: it is never a RunFailed.
          closeInFlight = true;
          const report = yield* closeStop({
            runId,
            shortName: shortName as string,
            runPath,
            phase,
            phaseFolder: heldFolder,
            worktree: stopReentry.worktree as string,
            gateSteps,
            gateRequest: phaseFactsFor(heldFolder, phase.id, false).pipe(
              Effect.map(serializeGateRequest),
            ),
            fileReconciliationMode: config.fileReconciliationMode,
            phases: plan.phases,
            oracles: config.oracles ?? null,
            mainCheckout: config.repoRoot,
          });
          closeInFlight = false;
          opts.onStopClosed?.({ phaseId: phase.id, phaseTitle: phase.title, report });
          yield* writeHeldRecord(recordStopOf(report));
        } else if (closedStopOwesRecord) {
          if (heldRecord.closedStop === undefined) {
            return yield* Effect.dieMessage(`No recorded stop for the closed stop at ${phase.id}`);
          }
          yield* writeHeldRecord(heldRecord.closedStop);
        }
        yield* Effect.promise(() => patchAgentBindingStatus(heldFolder, "completed"));
        yield* cleanupCommittedPhase({
          phase,
          worktreePath: stopReentry.worktree,
          phaseFolderPath: heldFolder,
          cleanupCommands,
        });
        previousPhaseBranch = stopReentry.branch;
        continue;
      }

      if (i === startIndex && resumeAfterHandoff) {
        // What follows a valid handoff on the committed path, in its order:
        // the pulled briefs, the record and the cleanup. No agent turn, gate,
        // commit or handoff turn runs.
        if (postHandoffInputs === undefined) {
          return yield* Effect.dieMessage(
            `No checked inputs for what follows ${phase.id}'s handoff`,
          );
        }
        const { worktree, assignment } = postHandoffInputs;
        const folder = join(runPath, phase.id);
        currentPhaseId = phase.id;
        currentPhaseFolderPath = folder;
        currentWorktreePath = worktree === null ? undefined : (worktree as string);
        currentSessionId = undefined;
        // Left unset: the phase committed, so no failure from here writes a
        // `failed` record, and the record below is passed its values.
        currentProvider = undefined;
        currentModel = undefined;
        currentEffort = undefined;

        // Briefs pulled into a gone worktree are gone with it; collecting
        // would only recreate its directory.
        if (config.brief !== undefined && worktree !== null) {
          yield* closePulledBriefs({
            worktreePath: worktree as string,
            phaseFolderPath: folder,
            phaseId: phase.id,
          });
        }
        if (assignment !== null && postHandoffOwesRecord) {
          yield* writeRecordForPhase({
            phaseId: phase.id,
            phaseFolderPath: folder,
            provider: assignment.provider,
            model: assignment.model,
            effort: assignment.effort,
            mode: phase.mode,
            stop: null,
            usage: { kind: "session", sessionId: resumeSessionId },
            outcome: "committed",
            sourceSha: postHandoffInputs.sourceSha,
          });
        }
        yield* Effect.promise(() => patchAgentBindingStatus(folder, "completed"));
        if (worktree !== null) {
          yield* cleanupCommittedPhase({
            phase,
            worktreePath: worktree,
            phaseFolderPath: folder,
            cleanupCommands,
          });
        } else {
          // The cleanup commands run in the worktree, which is gone: only the
          // cleanup's state events run, so the phase is cleaned up and the run
          // goes on instead of pausing in a cleanup it can never finish. The
          // commands not run are named, since one may free resources outside
          // the worktree.
          if (cleanupCommands.length > 0) {
            process.stderr.write(
              `[phax] Warning: phase "${phase.id}" — its worktree is gone, so its cleanup commands did not run: ${cleanupCommands.join("; ")}. Run them yourself if they free resources outside the worktree.\n`,
            );
          }
          yield* dispatch(
            { ...eventBase(phase.id), type: "CleanupStarted" },
            dispatchCtx(folder, phase.id),
          );
          yield* dispatch(
            { ...eventBase(phase.id), type: "CleanupCompleted" },
            dispatchCtx(folder, phase.id),
          );
        }
        previousPhaseBranch = postHandoffInputs.branch;
        continue;
      }

      let phaseBranch: BranchName;
      let phaseFolderPath: string;
      let worktreePath: WorktreePath;
      let sessionId: ClaudeSessionId;
      let agentOptions: AgentRunOptions;
      // Built at most once per phase entry, and shared by the brief request
      // and the gate request.
      let phaseFacts: GateRequest | undefined;

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
        // Only these two re-entries run the agent again; a commit, cleanup or
        // completion re-entry runs none, so it needs no fresh copy.
        if (isResumeFromGate || isResumeFromHandoff) {
          yield* writePhasePlanFile(worktreePath as string, planMd);
        }
        // A resume asks no new brief (spec §5.6) but restores the request file.
        if (config.brief !== undefined) {
          phaseFacts = yield* phaseFactsFor(phaseFolderPath, phase.id, isFinal);
          yield* writeBriefRequestOrWarn(
            worktreePath as string,
            phase.id,
            stampBriefRequest(phaseBriefRequest(phaseFacts, null)),
          );
        }
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
          gateCommands: gateCommandStrings,
          briefCommands,
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
          skillEditGrants,
          outputJsonlPath: join(phaseFolderPath, "output.jsonl"),
          phaseFolderPath,
        };
      } else {
        // Each phase gets its own branch (<run.branch>--<phaseId>) so multiple
        // worktrees can coexist — git refuses to check out one branch in two
        // worktrees simultaneously.
        const preparedBranch = yield* preparePhaseBranch(
          branch,
          phaseIdResult.right,
          previousPhaseBranch,
          config.repoRoot,
        );
        phaseBranch = preparedBranch.branch;

        phaseFolderPath = yield* createPhaseFolder(
          runPath,
          phase,
          i,
          preparedBranch,
          config.repoRoot,
        );
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
        yield* writePhasePlanFile(worktreePath as string, planMd);

        const previousHandoff = yield* readPreviousHandoff(runPath, plan.phases, i);
        const previousReconciliation = yield* readPreviousReconciliation(runPath, plan.phases, i);
        const reviewCorrections = yield* reviewCorrectionsFor(i, hold);

        const fs = yield* FileSystem;

        let briefSection: string | undefined;
        if (config.brief !== undefined) {
          phaseFacts = yield* phaseFactsFor(phaseFolderPath, phase.id, isFinal);
          const briefRequest = stampBriefRequest(phaseBriefRequest(phaseFacts, null));
          yield* writeBriefRequestOrWarn(worktreePath as string, phase.id, briefRequest);
          briefSection = yield* pushBrief({
            command: config.brief.command,
            push: config.brief.push,
            request: briefRequest,
            worktreePath: worktreePath as string,
            phaseFolderPath,
            phaseId: phase.id,
          });
        }

        // The phase-sections preflight located every phase, so a miss is a defect.
        const phaseSection = planSections.sections.get(phase.id);
        if (phaseSection === undefined) {
          return yield* Effect.dieMessage(
            `Phase "${phase.id}" has no located plan.md section after the phase-sections preflight`,
          );
        }
        const promptText = buildPhasePrompt({
          planPreamble: planSections.preamble,
          phaseSection,
          plan,
          currentPhase: phase,
          previousHandoff,
          previousReconciliation,
          reviewCorrections,
          gateCommands: gateCommandStrings,
          briefSection,
          oracleRole: oracleRoleOf(plan.phases, phase.id),
        });

        yield* fs.writeAtomic(join(phaseFolderPath, "prompt.md"), promptText);

        const { resolution, securityPolicy, frozenResult } = yield* resolvePhaseAgent({
          phase,
          worktreePath: worktreePath as string,
          phaseFolderPath,
          gateCommands: gateCommandStrings,
          briefCommands,
          skillEditGrants,
        });

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
          skillEditGrants,
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
          withInvocationCost(backend.runAgent(promptText, agentOptions), {
            role: "phase",
            phase: phase.id,
            runId,
            runPath,
            provider: resolvedProvider,
            streamPath: join(phaseFolderPath, "output.jsonl"),
          }).pipe(
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

      // The log of the gate attempt that let the commit through: the passing
      // attempt when the gate runs during this entry, else (a commit-only
      // resume) the highest recorded attempt, or null when none is recorded.
      let gateLogPath: string | null = null;

      if (
        !isResumeFromHandoff &&
        !isResumeFromCommit &&
        !isResumeFromCleanup &&
        !isResumeFromCompletion
      ) {
        // running → passed transition is dispatched inside fixLoop on the
        // gate-success branch via dispatch(GatePassed). On every entry, a
        // resume included, the loop numbers each attempt one above the highest
        // per-attempt file in the phase folder, so numbering continues and no
        // earlier attempt's files are overwritten; each entry gets a fresh fix
        // budget.
        const phaseSteps = selectGateSteps(gateSteps, isFinal);
        // One request per phase entry, from the base noted when phax created
        // the branch — never re-derived from git — so every attempt, and a
        // resume, hands declaring steps the same facts.
        const gateRequest = serializeGateRequest(
          phaseFacts ?? (yield* phaseFactsFor(phaseFolderPath, phase.id, isFinal)),
        );
        const oracleStep = yield* oracleStepFor(
          phaseFolderPath,
          phase.id,
          skipOracle && i === startIndex,
        );
        const gateOutcome = yield* runGatesWithFixLoop({
          steps: phaseSteps,
          cwd: worktreePath as string,
          phaseFolderPath,
          sessionId,
          agentOptions,
          maxFixAttempts: config.maxFixAttempts,
          run: shortName as string,
          phaseId: phase.id,
          runPath,
          gateRequest,
          ...(oracleStep === undefined ? {} : { oracleStep }),
          ...(isResumeFromGate ? { worktreePath: worktreePath as string } : {}),
        });
        gateLogPath = gateOutcome.attemptLogPath;
      } else if (isResumeFromCommit) {
        const fs = yield* FileSystem;
        const logName = lastRecordedAttemptLogName(yield* fs.list(phaseFolderPath));
        gateLogPath = logName === undefined ? null : join(phaseFolderPath, logName);
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
          gateLogPath,
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
          const reconPath = join(phaseFolderPath, "file-reconciliation.json");
          const reconRaw = yield* fs.readText(reconPath);
          const reconDecoded = readPhaseFileReconciliationFile(reconPath, JSON.parse(reconRaw));
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
                reviewCorrections: [],
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
            oracleFiles: dischargedOracleFiles(plan.phases, phase.id),
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

      // The pulled briefs land in the phase folder before the record lists it,
      // whether or not records are on, and the folder closes to later pulls.
      if (config.brief !== undefined) {
        yield* closePulledBriefs({
          worktreePath: worktreePath as string,
          phaseFolderPath,
          phaseId: phase.id,
        });
      }

      // A phase of the run's hold stops here, once committed with its handoff
      // validated, before its record and its cleanup.
      if (!isFinal && holdsPhase(hold, phase.id)) {
        yield* holdPoint({ phase, phaseIndex: i, phaseFolderPath, worktreePath });
      }

      // Terminal committed outcome: assemble and write this phase's record onto
      // phax/records/v1 before any run-completion bookkeeping, so no record is
      // ever written for phax's own archival commit (spec §5.1). The source sha
      // is the phase commit, resolved from the worktree HEAD; a lookup failure
      // simply omits the back-reference rather than failing the phase. A phase
      // pauses in cleanup only after its record was written, so a cleanup
      // re-entry writes none.
      if (config.records.enabled && !isResumeFromCleanup) {
        const recordSourceSha = yield* git
          .headCommit(worktreePath as string)
          .pipe(Effect.orElseSucceed(() => undefined as string | undefined));
        yield* writeRecordForPhase({
          phaseId: phase.id,
          phaseFolderPath,
          provider: agentOptions.provider,
          model: agentOptions.model,
          effort: agentOptions.effort,
          mode: phase.mode,
          stop: null,
          usage: { kind: "session", sessionId: sessionId as string },
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
        finalReviewStatuses = infoResult.right.phaseStatuses;
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
          // The spec outcome reaches every later handoff build (this one,
          // `phax review-handoff`, publish) through a run-folder fragment; a
          // resume re-entering completion rewrites it identically.
          const sourceSpecOutcome = renderSourceSpecOutcome(artifactCompletions);
          if (sourceSpecOutcome !== undefined) {
            const fs = yield* FileSystem;
            yield* fs.writeAtomic(
              join(infoResult.right.runPath, SOURCE_SPEC_OUTCOME_FILENAME),
              `${sourceSpecOutcome}\n`,
            );
          }
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
          const reviewResolution = resolveModel(
            { model: config.complianceReview.model, effort: config.complianceReview.effort },
            routing,
            providerConfig,
            securityFilterFor(reviewPolicy),
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
            phaxVersion: opts.phaxVersion,
            records: config.records,
            ...(config.records.destination.kind === "repo"
              ? { recordsClonePath: recordsClonePath(config.stateRoot, namespace) }
              : {}),
            ...(opts.verbose !== undefined ? { verbose: opts.verbose } : {}),
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
          if (publicationResult?.kind === "published" && publicationResult.prUrl !== undefined) {
            publishedPrUrl = publicationResult.prUrl;
          }
        }
      } else {
        yield* Effect.promise(() => patchAgentBindingStatus(phaseFolderPath, "completed"));
        yield* cleanupCommittedPhase({ phase, worktreePath, phaseFolderPath, cleanupCommands });
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

    // Every phase of the run that committed, across resumes, read from disk
    // once the review opened: this invocation alone may have started late.
    // The run is complete by now, so an unreadable run folder never fails
    // it: the count falls back to the statuses read for the final review,
    // which hold the same committed phases (the final one `committed` then).
    const completedPhaseCount = countCompletedPhases(
      Either.match(resolveRun(namespace, shortName, config.stateRoot), {
        onLeft: () => finalReviewStatuses,
        onRight: (info) => info.phaseStatuses,
      }),
    );

    return {
      completedPhaseCount,
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
    // The pulled briefs are collected first so the record carries them; a
    // paused phase keeps accumulating pulls across sessions instead.
    Effect.tapError((e) =>
      Effect.gen(function* () {
        if (isResumablePauseError(e) || currentPhaseId === undefined) return;
        // No agent session built an interactive phase, so it gets no `failed`
        // record: its record is written once, when its stop closes.
        const failedPhaseId = currentPhaseId;
        const failedPhase = plan.phases.find((p) => p.id === failedPhaseId);
        if (failedPhase === undefined || failedPhase.mode === "interactive") return;
        // A held phase committed before it stopped: nothing after its commit
        // writes a `failed` record for it, so a phase with a stop writes none.
        if (currentPhaseFolderPath !== undefined) {
          const status = yield* Effect.either(readPhaseStatus(currentPhaseFolderPath));
          if (Either.isRight(status) && status.right.stop !== null) return;
        }
        if (
          config.brief !== undefined &&
          currentWorktreePath !== undefined &&
          currentPhaseFolderPath !== undefined
        ) {
          yield* closePulledBriefs({
            worktreePath: currentWorktreePath,
            phaseFolderPath: currentPhaseFolderPath,
            phaseId: currentPhaseId,
          });
        }
        if (
          currentPhaseFolderPath !== undefined &&
          currentProvider !== undefined &&
          currentModel !== undefined &&
          currentEffort !== undefined
        ) {
          yield* writeRecordForPhase({
            phaseId: currentPhaseId,
            phaseFolderPath: currentPhaseFolderPath,
            provider: currentProvider,
            model: currentModel,
            effort: currentEffort,
            mode: failedPhase.mode,
            stop: null,
            usage: { kind: "session", sessionId: currentSessionId },
            outcome: "failed",
            failOnRefusal: false,
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      }),
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
    // A refused gate report pauses the run the same way: GateStepRefused was
    // dispatched inside the fix loop (interrupted, phase `gates_exhausted`,
    // resume-instructions.md written), so we just re-raise here.
    Effect.catchIf(isGateStepRefusedError, (e) =>
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
    // A hold point that failed pauses the run instead of failing it:
    // HoldPointFailed was dispatched at the hold point (interrupted, the phase
    // committed, resume-instructions.md written), so we just re-raise here.
    Effect.catchIf(isHoldPointPausedError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    // A records destination that refused a closed stop's record pauses the
    // run instead of failing it: StopRecordRefused was dispatched where the
    // record was refused (interrupted, the phase committed with its stop
    // closed, resume-instructions.md written), so we just re-raise here.
    Effect.catchIf(isStopRecordPausedError, (e) =>
      Effect.gen(function* () {
        return yield* Effect.fail(e);
      }),
    ),
    // The interactive preflight refusal leaves an existing run's state and last
    // error as they were (spec §5.9): the plan is fixed, then resumed again. A
    // close, declared or held, that fails past its commit is finished by a resume, so it
    // never fails the run either, nor does a re-entry read that fails before
    // RunResumeRequested.
    Effect.tapError((e) =>
      isResumablePauseError(e) ||
      e instanceof InteractivePreflightError ||
      closeInFlight ||
      reentryReading
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
