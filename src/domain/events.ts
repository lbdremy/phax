import type { ClaudeSessionId, PhaseId, RunId, WorktreePath } from "./branded.js";
import type { RateLimitError, UsageLimitError } from "./errors.js";
import type { RunReviewInfo } from "./runReviewInfo.js";

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
  readonly from: string;
  readonly to: string;
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

// Cross-cutting: affects both run and phase substate.
export interface RateLimitDetected extends PhaxEventBase {
  readonly type: "RateLimitDetected";
  readonly kind: "rate_limit" | "usage_limit";
  readonly resetAt?: string | undefined;
  readonly cause: RateLimitError | UsageLimitError;
  readonly worktreePath?: WorktreePath | undefined;
  readonly sessionId?: ClaudeSessionId | undefined;
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
  | HandoffRequested
  | HandoffValidated
  | HandoffMissing
  | CommitCreated
  | CleanupStarted
  | CleanupCompleted
  | RateLimitDetected;

export type PhaxEventType = PhaxEvent["type"];
