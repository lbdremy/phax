import type { PhaseState } from "./state.js";

/**
 * The states a phase reaches only after its commit lands. `awaiting_review`
 * is out: a declared stop waits there before its close commits, and a held
 * stop's commit is counted once its close moves it on. `skipped` is out: the
 * phase produced no commit.
 */
const COMPLETED_PHASE_STATES: ReadonlySet<PhaseState> = new Set<PhaseState>([
  "committed",
  "handoff_failed",
  "cleaning_up",
  "cleaned_up",
  "review_open",
]);

/** How many of a run's phases committed, read from their persisted states. */
export function countCompletedPhases(statuses: readonly { readonly state: PhaseState }[]): number {
  return statuses.filter((s) => COMPLETED_PHASE_STATES.has(s.state)).length;
}
