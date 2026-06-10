import type { PhaseStatus, RunStatus } from "../schemas/status.js";
import type { PhaseSubState, PhaxState } from "../domain/state.js";

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
  }
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
  }
}
