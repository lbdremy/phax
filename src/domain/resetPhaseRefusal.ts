/**
 * The refusals of `phax reset-phase`, shared by the reset and its preview.
 * Pure: the caller passes the run's statuses, the plan's phases, the composed
 * state of the target and the `PhaseResetRequested` event to interpret.
 */
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import type { PhaseStatus } from "../schemas/status.js";
import type { PhaseResetRequested } from "./events.js";
import { oracleRoleOf, stopOraclePairs } from "./plan/oraclePairs.js";
import { interpret } from "./reducer.js";
import type { PhaxState } from "./state.js";

export type ResetRefusalReason =
  | "phase_not_at_stop"
  | "phase_blocked_by_discharge"
  | "phase_blocked_by_later_committed"
  | "not_resettable";

export interface ResetRefusal {
  readonly reason: ResetRefusalReason;
  readonly message: string;
}

export const TERMINAL_COMMITTED_STATES = new Set<PhaseStatus["state"]>(["committed", "cleaned_up"]);

// A discharge the next resume restarts at, so `--skip-oracle` reaches its oracle step.
const STOPPED_AT_GATE_STATES = new Set<PhaseStatus["state"]>([
  "gates_exhausted",
  "gates_failed",
  "failed",
]);

/** The phase a run in `awaiting_review` waits at; undefined for any other run. */
export function stoppedPhaseOf(info: {
  readonly runState: string;
  readonly phaseStatuses: readonly PhaseStatus[];
}): PhaseStatus | undefined {
  if (info.runState !== "awaiting_review") return undefined;
  return info.phaseStatuses
    .filter((p) => p.state === "awaiting_review")
    .toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0];
}

// While a run awaits review, only the stopped phase can be reset: an earlier
// phase is committed work the stop sits on, and a later one has not started.
function checkTargetAtStop(
  shortName: string,
  target: PhaseStatus,
  stopped: PhaseStatus | undefined,
): ResetRefusal | null {
  if (stopped === undefined || target.phaseId === stopped.phaseId) return null;
  const why =
    target.phaseIndex < stopped.phaseIndex
      ? `Reset "${stopped.phaseId}" first (\`phax reset-phase ${shortName} ${stopped.phaseId}\`).`
      : `"${target.phaseId}" has not started.`;
  return {
    reason: "phase_not_at_stop",
    message: `Cannot reset "${target.phaseId}" of run "${shortName}": the run is awaiting review at "${stopped.phaseId}". ${why}`,
  };
}

export interface ResetRefusalInput {
  readonly shortName: string;
  readonly runState: string;
  readonly target: PhaseStatus;
  readonly phaseStatuses: readonly PhaseStatus[];
  /** The plan's phases; undefined when `phax-plan.json` is unreadable. */
  readonly planPhases: readonly PhaxPlanPhase[] | undefined;
  /**
   * The composed state of the run with `target` as its phase. Read last, so an
   * earlier refusal never composes a state the caller could not (a phase at
   * review with no stop recorded).
   */
  readonly state: () => PhaxState;
  /** The `PhaseResetRequested` event the reducer interprets for `target`. */
  readonly event: PhaseResetRequested;
}

/** Why the target cannot be reset, or null when the reset may go on. */
export function resetPhaseRefusal(input: ResetRefusalInput): ResetRefusal | null {
  const { shortName, target, phaseStatuses, planPhases } = input;

  const notAtStop = checkTargetAtStop(
    shortName,
    target,
    stoppedPhaseOf({ runState: input.runState, phaseStatuses }),
  );
  if (notAtStop !== null) return notAtStop;

  // An oracle phase is not reset once its discharge has started: the
  // discharge judges this phase's commit, which a reset would discard. A
  // committed oracle phase is never resettable anyway.
  const role = planPhases === undefined ? null : oracleRoleOf(planPhases, target.phaseId);
  const discharging = role?.role === "oracle" ? role.pair.dischargingPhase : undefined;
  const dischargingStatus = phaseStatuses.find((p) => p.phaseId === discharging);
  if (dischargingStatus !== undefined && dischargingStatus.state !== "pending") {
    return {
      reason: "phase_blocked_by_discharge",
      // The skip recovery applies only while the discharge is the stopped
      // phase: a resume skips the oracle step of the phase it restarts at.
      message:
        `Cannot reset "${target.phaseId}" of run "${shortName}": its discharging phase "${dischargingStatus.phaseId}" is ${dischargingStatus.state}, and a committed oracle phase is not reset.` +
        (STOPPED_AT_GATE_STATES.has(dischargingStatus.state)
          ? ` To correct the oracle, edit it in ${dischargingStatus.phaseId} (\`phax enter-phase ${shortName} ${dischargingStatus.phaseId}\`), then run \`phax resume ${shortName} --yes --skip-oracle\`: the configured gate still runs.`
          : ""),
    };
  }

  // Nor is a phase whose closed stop ran the `authored` step once its
  // pair's discharge has started: the discharge judges this phase's commit.
  const authoredStop =
    target.stop !== null &&
    target.stop.status === "closed" &&
    target.stop.outcome === "corrected" &&
    target.stop.oracleStep === "authored";
  if (authoredStop && planPhases !== undefined) {
    for (const pair of stopOraclePairs(planPhases, target.phaseId)) {
      const status = phaseStatuses.find((p) => p.phaseId === pair.dischargingPhase);
      if (status === undefined || status.state === "pending") continue;
      return {
        reason: "phase_blocked_by_discharge",
        // The same recovery as for the oracle phase (§5.36), while the
        // discharge is the stopped phase.
        message:
          `Cannot reset '${target.phaseId}' of run '${shortName}': its discharging phase '${status.phaseId}' is ${status.state}, and the discharge judges this phase's commit.` +
          (STOPPED_AT_GATE_STATES.has(status.state)
            ? ` To correct the oracle, edit it in ${status.phaseId} (\`phax enter-phase ${shortName} ${status.phaseId}\`), then run \`phax resume ${shortName} --yes --skip-oracle\`: the configured gate still runs.`
            : ""),
      };
    }
  }

  const laterCommitted = phaseStatuses.find(
    (p) => p.phaseIndex > target.phaseIndex && TERMINAL_COMMITTED_STATES.has(p.state),
  );
  if (laterCommitted !== undefined) {
    return {
      reason: "phase_blocked_by_later_committed",
      message: `Cannot reset "${target.phaseId}" of run "${shortName}": later phase "${laterCommitted.phaseId}" is already ${laterCommitted.state}.`,
    };
  }

  const disposition = interpret(input.state(), input.event);
  if (disposition.kind !== "Handled") {
    return {
      reason: "not_resettable",
      message: `Cannot reset phase "${target.phaseId}" of run "${shortName}": ${disposition.reason ?? "current state does not allow reset"}.`,
    };
  }
  return null;
}
