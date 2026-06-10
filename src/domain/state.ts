import { Either } from "effect";
import { InvalidTransitionError } from "./errors.js";

export type RunState =
  | "created"
  | "running"
  | "failed"
  | "review_open"
  | "completed"
  | "stopped"
  | "archived"
  | "interrupted"
  | "rate_limited";

export type PhaseState =
  | "pending"
  | "setting_up_worktree"
  | "running"
  | "gates_failed"
  | "gates_exhausted"
  | "fixing"
  | "failed"
  | "passed"
  | "committed"
  | "cleaning_up"
  | "cleaned_up"
  | "review_open"
  | "handoff_failed"
  | "skipped"
  | "rate_limited";

// Hierarchical state model. The dispatcher (phase-03) composes a PhaxState
// from the flat RunStatus + PhaseStatus persisted on disk; the reducer
// (phase-02) operates exclusively on this hierarchical view.

export type PhaseSubState =
  | { readonly state: "pending" }
  | { readonly state: "setting_up_worktree" }
  | { readonly state: "running" }
  | { readonly state: "gates_failed"; readonly attempt: number }
  | { readonly state: "gates_exhausted"; readonly attempt: number }
  | { readonly state: "fixing"; readonly attempt: number }
  | { readonly state: "passed" }
  | { readonly state: "committed"; readonly hash: string }
  | { readonly state: "cleaning_up" }
  | { readonly state: "cleaned_up" }
  | { readonly state: "handoff_failed"; readonly missing: readonly string[] }
  | { readonly state: "failed"; readonly cause: string }
  | { readonly state: "skipped" }
  | { readonly state: "rate_limited" }
  | { readonly state: "review_open" };

export type PhaseSubStateName = PhaseSubState["state"];

export type PhaxState =
  | { readonly run: "created" }
  | { readonly run: "running"; readonly phase: PhaseSubState }
  | { readonly run: "rate_limited"; readonly phase: PhaseSubState }
  | { readonly run: "interrupted"; readonly phase: PhaseSubState }
  | { readonly run: "review_open"; readonly phase: { readonly state: "review_open" } }
  | { readonly run: "failed"; readonly cause: string }
  | { readonly run: "completed" }
  | { readonly run: "stopped" }
  | { readonly run: "archived" };

export type PhaxStateName = PhaxState["run"];

type RunTransition = Either.Either<RunState, InvalidTransitionError>;
type PhaseTransition = Either.Either<PhaseState, InvalidTransitionError>;

function runTransition(from: RunState, to: RunState, allowed: RunState[]): RunTransition {
  if (allowed.includes(from)) return Either.right(to);
  return Either.left(new InvalidTransitionError({ from, to, entity: "run" }));
}

function phaseTransition(from: PhaseState, to: PhaseState, allowed: PhaseState[]): PhaseTransition {
  if (allowed.includes(from)) return Either.right(to);
  return Either.left(new InvalidTransitionError({ from, to, entity: "phase" }));
}

// Run transitions
/** @deprecated Subsumed by the reducer in src/domain/reducer.ts; kept for compatibility with the current runtime wiring until phase-06. */
export const startRun = (state: RunState): RunTransition =>
  runTransition(state, "running", ["created"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const failRun = (state: RunState): RunTransition =>
  runTransition(state, "failed", ["running"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const stopRun = (state: RunState): RunTransition =>
  runTransition(state, "stopped", ["running"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const interruptRun = (state: RunState): RunTransition =>
  runTransition(state, "interrupted", ["running"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const openRunReview = (state: RunState): RunTransition =>
  runTransition(state, "review_open", ["running"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const completeRun = (state: RunState): RunTransition =>
  runTransition(state, "completed", ["running"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const archiveRun = (state: RunState): RunTransition =>
  runTransition(state, "archived", ["review_open", "completed"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const rateLimitRun = (state: RunState): RunTransition =>
  runTransition(state, "rate_limited", ["running"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const resumeRateLimitedRun = (state: RunState): RunTransition =>
  runTransition(state, "running", ["rate_limited"]);

// Phase transitions
/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const pendingToSettingUp = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "setting_up_worktree", ["pending"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const settingUpToRunning = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "running", ["setting_up_worktree"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const runningToPassed = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "passed", ["running", "fixing"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const committedToCleanedUp = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "cleaned_up", ["committed"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const committedToReviewOpen = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "review_open", ["committed"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const skipPhase = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "skipped", ["pending"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const rateLimitPhase = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "rate_limited", ["running", "fixing"]);

/** @deprecated Subsumed by the reducer in src/domain/reducer.ts. */
export const rateLimitedToRunning = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "running", ["rate_limited"]);

export const TERMINAL_PHASE_STATES = new Set<PhaseState>([
  "committed",
  "cleaned_up",
  "review_open",
  "skipped",
]);

export const isPhaseTerminal = (s: PhaseState): boolean => TERMINAL_PHASE_STATES.has(s);
