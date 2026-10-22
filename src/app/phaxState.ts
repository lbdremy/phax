import type { PhaseStatus, RunStatus } from "../schemas/status.js";
import type { PhaseSubState, PhaxState, StopCause } from "../domain/state.js";

export function phaseSubStateFromStatus(status: PhaseStatus): PhaseSubState {
  switch (status.state) {
    case "pending":
      return { state: "pending" };
    case "setting_up_worktree":
      return { state: "setting_up_worktree" };
    case "running":
      return { state: "running" };
    case "gates_failed":
      return { state: "gates_failed", attempt: 0 };
    case "gates_exhausted":
      return { state: "gates_exhausted", attempt: 0 };
    case "fixing":
      return { state: "fixing", attempt: 0 };
    case "passed":
      return { state: "passed" };
    case "committed":
      return { state: "committed", hash: status.commitHash ?? "" };
    case "cleaning_up":
      return { state: "cleaning_up" };
    case "cleaned_up":
      return { state: "cleaned_up" };
    case "skipped":
      return { state: "skipped" };
    case "rate_limited":
      return { state: "rate_limited" };
    case "handoff_failed":
      return { state: "handoff_failed", missing: [] };
    case "failed":
      return { state: "failed", cause: "unknown" };
    case "review_open":
      return { state: "review_open" };
    case "awaiting_review":
      return { state: "awaiting_review", cause: stopCauseOf(status) };
  }
}

// A phase only enters awaiting_review with its stop recorded, and the status
// reader refuses one without it: a missing stop is a defect, never a default.
function stopCauseOf(status: PhaseStatus): StopCause {
  if (status.stop === null) {
    throw new Error(`Phase ${status.phaseId} is awaiting review with no stop recorded`);
  }
  return status.stop.cause;
}

export function composePhaxState(
  runState: RunStatus["state"],
  lastError: string | undefined,
  phase: PhaseStatus | undefined,
): PhaxState {
  switch (runState) {
    case "created":
      return { run: "created" };
    case "completed":
      return { run: "completed" };
    case "stopped":
      return { run: "stopped" };
    case "archived":
      return { run: "archived" };
    case "failed":
      return { run: "failed", cause: lastError ?? "unknown" };
    case "review_open":
      return { run: "review_open", phase: { state: "review_open" } };
    case "running":
      return {
        run: "running",
        phase: phase ? phaseSubStateFromStatus(phase) : { state: "pending" },
      };
    case "rate_limited":
      return {
        run: "rate_limited",
        phase: phase ? phaseSubStateFromStatus(phase) : { state: "rate_limited" },
      };
    case "interrupted":
      return {
        run: "interrupted",
        phase: phase ? phaseSubStateFromStatus(phase) : { state: "pending" },
      };
    // The stopped phase's status names the cause. A run that is `running` with
    // its phase awaiting_review is a close in progress, composed above.
    case "awaiting_review":
      return {
        run: "awaiting_review",
        phase: { state: "awaiting_review", cause: phase ? stopCauseOf(phase) : "declared" },
      };
  }
}
