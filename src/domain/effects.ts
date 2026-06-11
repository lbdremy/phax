import type { PhaseStatus, RunStatus } from "../schemas/status.js";
import type { RunReviewInfo } from "./runReviewInfo.js";

export type { RunReviewInfo };

export interface StatePatch {
  readonly run?: Partial<RunStatus> | undefined;
  readonly phase?: Partial<PhaseStatus> | undefined;
}

export interface ResumeContext {
  readonly reason: "Rate limit" | "Usage limit" | "No changes" | "Gate checks failed";
  readonly kind: "rate_limit" | "usage_limit" | "no_changes" | "gates_exhausted";
  readonly resetAt?: string | undefined;
  readonly phaseId?: string | undefined;
  readonly worktreePath?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly rawMessage?: string | undefined;
}

export interface PersistState {
  readonly type: "PersistState";
  readonly patch: StatePatch;
}

export interface EmitTrace {
  readonly type: "EmitTrace";
  readonly name: string;
  readonly status: "ok" | "failed" | "info";
  readonly boundary?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;
}

export interface WriteResumeInstructions {
  readonly type: "WriteResumeInstructions";
  readonly ctx: ResumeContext;
}

export interface RunCleanupShell {
  readonly type: "RunCleanupShell";
  readonly commands: readonly string[];
  readonly cwd: string;
}

export interface WriteAtomic {
  readonly type: "WriteAtomic";
  readonly path: string;
  readonly content: string;
}

export interface OpenRunReview {
  readonly type: "OpenRunReview";
  readonly info: RunReviewInfo;
}

export interface MoveRunToArchive {
  readonly type: "MoveRunToArchive";
  readonly from: string;
  readonly to: string;
}

export interface RecordCommitMetadata {
  readonly type: "RecordCommitMetadata";
  readonly hash: string;
}

export type PhaxCommand =
  | PersistState
  | EmitTrace
  | WriteResumeInstructions
  | RunCleanupShell
  | WriteAtomic
  | OpenRunReview
  | MoveRunToArchive
  | RecordCommitMetadata;

export type PhaxCommandType = PhaxCommand["type"];
