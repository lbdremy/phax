import type { LastClose, ReviewStop } from "../schemas/reviewStop.js";
import type { PhaseStatus, RunStatus } from "../schemas/status.js";
import type { RunReviewInfo } from "./runReviewInfo.js";
import type { ProtectedChange } from "./security/protectedPaths.js";

export type { RunReviewInfo };

export interface StatePatch {
  readonly run?: Partial<RunStatus> | undefined;
  readonly phase?: Partial<PhaseStatus> | undefined;
}

export interface ResumeContext {
  readonly reason:
    | "Rate limit"
    | "Usage limit"
    | "Network failure"
    | "No changes"
    | "Gate checks failed"
    | "Gate step refused"
    | "Commit failed"
    | "Cleanup failed"
    | "Artifact completion failed"
    | "Hold point failed"
    | "Records destination refused"
    | "Awaiting review";
  readonly kind:
    | "rate_limit"
    | "usage_limit"
    | "network_failure"
    | "no_changes"
    | "gates_exhausted"
    | "gate_refused"
    | "commit_failed"
    | "cleanup_failed"
    | "artifact_completion_failed"
    | "hold_point_failed"
    | "stop_record_refused"
    | "awaiting_review";
  readonly resetAt?: string | undefined;
  readonly phaseId?: string | undefined;
  readonly worktreePath?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly rawMessage?: string | undefined;
  /** The refused step, its reason and its remedy; set for kind `gate_refused`. */
  readonly refusal?: GateRefusal | undefined;
  /** Which step stopped the phase; set for kinds `gates_exhausted` and `gate_refused`. */
  readonly failedStep?: "configured" | "oracle" | "protected-paths" | undefined;
  /** The protected paths still changed; set for kinds `gates_exhausted` and `gate_refused`. */
  readonly protectedChanges?: readonly ProtectedChange[] | undefined;
  /** The last fix transcript of the phase, or null when none was made; set for kind `gates_exhausted`. */
  readonly lastFixTranscript?: string | null | undefined;
}

export interface GateRefusal {
  readonly command: string;
  readonly reason: string;
  readonly remedy: string;
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

// review-stop.json exists exactly while the run is awaiting_review. These four
// commands are its only lifecycle: written at the stop, parked in the phase
// folder while a close runs, restored when the close is refused or
// interrupted, and discarded when the stop commits, resets or is archived.

export interface WriteReviewStop {
  readonly type: "WriteReviewStop";
  readonly reviewStop: ReviewStop;
}

export interface ParkReviewStop {
  readonly type: "ParkReviewStop";
}

export interface RestoreReviewStop {
  readonly type: "RestoreReviewStop";
  readonly lastClose: LastClose;
}

export interface DiscardReviewStop {
  readonly type: "DiscardReviewStop";
}

export type PhaxCommand =
  | PersistState
  | EmitTrace
  | WriteResumeInstructions
  | RunCleanupShell
  | WriteAtomic
  | OpenRunReview
  | MoveRunToArchive
  | RecordCommitMetadata
  | WriteReviewStop
  | ParkReviewStop
  | RestoreReviewStop
  | DiscardReviewStop;

export type PhaxCommandType = PhaxCommand["type"];
