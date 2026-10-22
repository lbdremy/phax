import type { ClaudeSessionId, PhaseId, RunId, WorktreePath } from "./branded.js";
import type { RateLimitError, UsageLimitError } from "./errors.js";
import type { LastClose, ReviewStop } from "../schemas/reviewStop.js";
import type { RunReviewInfo } from "./runReviewInfo.js";
import type { StopCause } from "./state.js";

export interface PhaxEventBase {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly run: RunId;
  readonly phase?: PhaseId | undefined;
  readonly correlationId?: string | undefined;
}

// Run-shaped events
export interface RunStarted extends PhaxEventBase {
  readonly type: "RunStarted";
}

export interface RunResumeRequested extends PhaxEventBase {
  readonly type: "RunResumeRequested";
}

export interface RunInterruptRequested extends PhaxEventBase {
  readonly type: "RunInterruptRequested";
}

export interface RunArchiveRequested extends PhaxEventBase {
  readonly type: "RunArchiveRequested";
  readonly force: boolean;
  readonly from: string;
  readonly to: string;
  /** Source path of the worktrees folder (e.g. ~/.phax/worktrees/{short}). */
  readonly worktreesFrom?: string | undefined;
  /** Destination path inside the archive umbrella (e.g. ~/.phax/archive/{short}/worktrees). */
  readonly worktreesTo?: string | undefined;
}

export interface RunFailed extends PhaxEventBase {
  readonly type: "RunFailed";
  readonly cause: unknown;
}

export interface FinalReviewOpened extends PhaxEventBase {
  readonly type: "FinalReviewOpened";
  readonly info: RunReviewInfo;
}

export interface RunCompleted extends PhaxEventBase {
  readonly type: "RunCompleted";
}

// Phase-shaped events
export interface PhaseStartRequested extends PhaxEventBase {
  readonly type: "PhaseStartRequested";
  readonly phaseId: PhaseId;
}

export interface WorktreeCreated extends PhaxEventBase {
  readonly type: "WorktreeCreated";
  readonly path: WorktreePath;
}

export interface AgentInvocationStarted extends PhaxEventBase {
  readonly type: "AgentInvocationStarted";
}

export interface AgentInvocationCompleted extends PhaxEventBase {
  readonly type: "AgentInvocationCompleted";
  readonly sessionId: ClaudeSessionId;
}

export interface GateStarted extends PhaxEventBase {
  readonly type: "GateStarted";
  readonly attempt: number;
}

export interface GatePassed extends PhaxEventBase {
  readonly type: "GatePassed";
  readonly attempt: number;
}

export interface GateFailed extends PhaxEventBase {
  readonly type: "GateFailed";
  readonly command: string;
  readonly exitCode: number;
  readonly logPath: string;
  readonly attempt: number;
}

export interface FixStarted extends PhaxEventBase {
  readonly type: "FixStarted";
  readonly attempt: number;
}

export interface FixCompleted extends PhaxEventBase {
  readonly type: "FixCompleted";
  readonly sessionId: ClaudeSessionId;
}

export interface FixAttemptsExhausted extends PhaxEventBase {
  readonly type: "FixAttemptsExhausted";
  readonly attempt: number;
  readonly phaseId: PhaseId;
  readonly worktreePath: WorktreePath;
  readonly sessionId: ClaudeSessionId;
  readonly command: string;
  readonly failedStep: "configured" | "oracle";
}

// A report step refused to run. Pauses the phase as FixAttemptsExhausted does,
// with no fix attempt made.
export interface GateStepRefused extends PhaxEventBase {
  readonly type: "GateStepRefused";
  readonly attempt: number;
  readonly phaseId: PhaseId;
  readonly worktreePath: WorktreePath;
  readonly sessionId: ClaudeSessionId;
  readonly command: string;
  readonly reason: string;
  readonly remedy: string;
  readonly failedStep: "configured" | "oracle";
}

export interface HandoffRequested extends PhaxEventBase {
  readonly type: "HandoffRequested";
}

export interface HandoffValidated extends PhaxEventBase {
  readonly type: "HandoffValidated";
}

export interface HandoffMissing extends PhaxEventBase {
  readonly type: "HandoffMissing";
  readonly missingSections: readonly string[];
}

export interface CommitCreated extends PhaxEventBase {
  readonly type: "CommitCreated";
  readonly hash: string;
}

export interface CleanupStarted extends PhaxEventBase {
  readonly type: "CleanupStarted";
}

export interface CleanupCompleted extends PhaxEventBase {
  readonly type: "CleanupCompleted";
}

// Cross-cutting: a phase that produced no changes when the agent finished.
// Transitions run → interrupted, phase → skipped, writes resume-instructions.md.
export interface PhaseHadNoChanges extends PhaxEventBase {
  readonly type: "PhaseHadNoChanges";
  readonly phaseId: PhaseId;
  readonly worktreePath: WorktreePath;
  readonly sessionId: ClaudeSessionId;
  readonly reason: string;
}

// Cross-cutting: the commit step failed after the gate passed.
// Transitions run → interrupted while keeping phase → passed (resumable).
export interface CommitFailed extends PhaxEventBase {
  readonly type: "CommitFailed";
  readonly phaseId: PhaseId;
  readonly worktreePath: WorktreePath;
  readonly sessionId: ClaudeSessionId;
  readonly reason: string;
}

// Cross-cutting: the cleanup step failed after the phase committed.
// Transitions run → interrupted, phase → cleaning_up (resumable).
export interface CleanupFailed extends PhaxEventBase {
  readonly type: "CleanupFailed";
  readonly phaseId: PhaseId;
  readonly worktreePath: WorktreePath;
  readonly reason: string;
}

// Cross-cutting: the run-completion step failed after the final phase committed.
// Transitions run → interrupted, phase stays committed (resumable).
export interface ArtifactCompletionFailed extends PhaxEventBase {
  readonly type: "ArtifactCompletionFailed";
  readonly phaseId: PhaseId;
  readonly worktreePath: WorktreePath;
  readonly reason: string;
}

// Cross-cutting: affects both run and phase substate.
export interface RateLimitDetected extends PhaxEventBase {
  readonly type: "RateLimitDetected";
  readonly kind: "rate_limit" | "usage_limit";
  readonly resetAt?: string | undefined;
  readonly cause: RateLimitError | UsageLimitError;
  readonly worktreePath?: WorktreePath | undefined;
  readonly sessionId?: ClaudeSessionId | undefined;
}

// Operator command: reset a stuck phase so the run becomes resumable.
export interface PhaseResetRequested extends PhaxEventBase {
  readonly type: "PhaseResetRequested";
  readonly phaseId: PhaseId;
}

// The run reached a stop at a phase and waits for a person: run and phase
// enter awaiting_review, and review-stop.json is written.
export interface ReviewStopReached extends PhaxEventBase {
  readonly type: "ReviewStopReached";
  readonly phaseId: PhaseId;
  readonly cause: StopCause;
  readonly worktreePath: WorktreePath;
  readonly reviewStop: ReviewStop;
}

// A close of the stop was refused: the run returns to awaiting_review, and
// review-stop.json is restored with `lastClose`.
export interface StopCloseRefused extends PhaxEventBase {
  readonly type: "StopCloseRefused";
  readonly phaseId: PhaseId;
  readonly lastClose: LastClose;
}

// A close of the stop committed the gated tree: the phase is committed and
// review-stop.json is discarded.
export interface StopCommitted extends PhaxEventBase {
  readonly type: "StopCommitted";
  readonly phaseId: PhaseId;
  readonly hash: string;
  readonly outcome: "corrected" | "unchanged";
}

export type PhaxEvent =
  | RunStarted
  | RunResumeRequested
  | RunInterruptRequested
  | RunArchiveRequested
  | RunFailed
  | FinalReviewOpened
  | RunCompleted
  | PhaseStartRequested
  | WorktreeCreated
  | AgentInvocationStarted
  | AgentInvocationCompleted
  | GateStarted
  | GatePassed
  | GateFailed
  | FixStarted
  | FixCompleted
  | FixAttemptsExhausted
  | GateStepRefused
  | HandoffRequested
  | HandoffValidated
  | HandoffMissing
  | CommitCreated
  | CommitFailed
  | CleanupFailed
  | CleanupStarted
  | CleanupCompleted
  | PhaseHadNoChanges
  | ArtifactCompletionFailed
  | RateLimitDetected
  | PhaseResetRequested
  | ReviewStopReached
  | StopCloseRefused
  | StopCommitted;

export type PhaxEventType = PhaxEvent["type"];
