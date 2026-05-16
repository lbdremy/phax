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
export const startRun = (state: RunState): RunTransition =>
  runTransition(state, "running", ["created"]);

export const failRun = (state: RunState): RunTransition =>
  runTransition(state, "failed", ["running"]);

export const stopRun = (state: RunState): RunTransition =>
  runTransition(state, "stopped", ["running"]);

export const interruptRun = (state: RunState): RunTransition =>
  runTransition(state, "interrupted", ["running"]);

export const openRunReview = (state: RunState): RunTransition =>
  runTransition(state, "review_open", ["running"]);

export const completeRun = (state: RunState): RunTransition =>
  runTransition(state, "completed", ["running"]);

export const archiveRun = (state: RunState): RunTransition =>
  runTransition(state, "archived", ["review_open", "completed"]);

// A run pauses on a rate/usage limit; it stays resumable.
export const rateLimitRun = (state: RunState): RunTransition =>
  runTransition(state, "rate_limited", ["running"]);

// Resuming a rate-limited run brings it back to `running`.
export const resumeRateLimitedRun = (state: RunState): RunTransition =>
  runTransition(state, "running", ["rate_limited"]);

// Phase transitions
export const pendingToSettingUp = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "setting_up_worktree", ["pending"]);

export const settingUpToRunning = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "running", ["setting_up_worktree"]);

export const runningToGatesFailed = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "gates_failed", ["running"]);

export const gatesFailedToFixing = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "fixing", ["gates_failed"]);

export const fixingToRunning = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "running", ["fixing"]);

export const runningToPassed = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "passed", ["running", "fixing"]);

export const failPhase = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "failed", ["running", "fixing", "gates_failed", "setting_up_worktree"]);

export const passedToCommitted = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "committed", ["passed"]);

export const committedToCleaningUp = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "cleaning_up", ["committed"]);

export const cleaningUpToCleanedUp = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "cleaned_up", ["cleaning_up"]);

export const committedToCleanedUp = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "cleaned_up", ["committed"]);

export const committedToReviewOpen = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "review_open", ["committed"]);

export const passedToHandoffFailed = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "handoff_failed", ["passed"]);

export const skipPhase = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "skipped", ["pending"]);

// A phase pauses on a rate/usage limit while the agent is working.
export const rateLimitPhase = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "rate_limited", ["running", "fixing"]);

// Resuming a rate-limited phase brings it back to `running`.
export const rateLimitedToRunning = (state: PhaseState): PhaseTransition =>
  phaseTransition(state, "running", ["rate_limited"]);
