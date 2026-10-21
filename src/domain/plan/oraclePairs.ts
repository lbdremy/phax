/**
 * Oracle pairs (oracle-phases), resolved from `phax-plan.json`'s `oracle` keys:
 * each non-null `oracle` names the phase that discharges it and the files it
 * pins. Pure: callers pass the plan's phases.
 */
import type { PhaxPlanPhase } from "../../schemas/phaxPlan.js";
import type { RecordOracleRole } from "../../schemas/runRecord.js";

export interface OraclePair {
  readonly oraclePhase: string;
  readonly dischargingPhase: string;
  readonly files: readonly string[];
}

/** A phase's role in a pair: the oracle phase, or the phase that discharges it. */
export type OracleRole =
  | { readonly role: "oracle"; readonly pair: OraclePair }
  | { readonly role: "discharging"; readonly pair: OraclePair };

type PairPhase = Pick<PhaxPlanPhase, "id" | "oracle">;

/** Every pair of the plan, in plan order of the oracle phase. */
export function oraclePairs(phases: ReadonlyArray<PairPhase>): readonly OraclePair[] {
  return phases.flatMap((phase) =>
    phase.oracle === null
      ? []
      : [
          {
            oraclePhase: phase.id,
            dischargingPhase: phase.oracle.dischargedBy,
            files: phase.oracle.files,
          },
        ],
  );
}

/** The role `phaseId` plays in the plan's pairs, or null when it is in none. */
export function oracleRoleOf(phases: ReadonlyArray<PairPhase>, phaseId: string): OracleRole | null {
  for (const pair of oraclePairs(phases)) {
    if (pair.oraclePhase === phaseId) return { role: "oracle", pair };
    if (pair.dischargingPhase === phaseId) return { role: "discharging", pair };
  }
  return null;
}

/** The role as a phase record's manifest stores it. */
export function recordOracleRole(role: OracleRole | null): RecordOracleRole {
  if (role === null) return null;
  return role.role === "oracle"
    ? { role: "oracle", dischargedBy: role.pair.dischargingPhase }
    : { role: "discharging", oraclePhase: role.pair.oraclePhase };
}
