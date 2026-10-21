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

/**
 * The oracle files `phaseId` discharges: its pair's files when it is a
 * discharging phase, else none. Reconciliation counts them as optional files,
 * so removing a marker is never an unplanned edit.
 */
export function dischargedOracleFiles(
  phases: ReadonlyArray<PairPhase>,
  phaseId: string,
): readonly string[] {
  const role = oracleRoleOf(phases, phaseId);
  return role?.role === "discharging" ? role.pair.files : [];
}

/** The role as a phase record's manifest stores it. */
export function recordOracleRole(role: OracleRole | null): RecordOracleRole {
  if (role === null) return null;
  return role.role === "oracle"
    ? { role: "oracle", dischargedBy: role.pair.dischargingPhase }
    : { role: "discharging", oraclePhase: role.pair.oraclePhase };
}

/** The last oracle-step result of one side of a pair, `not run` when it has none. */
export type OraclePairResult = "pass" | "fail" | "refused" | "not run";

export interface OraclePairRow {
  readonly oraclePhase: string;
  readonly dischargingPhase: string;
  readonly authored: OraclePairResult;
  readonly discharged: OraclePairResult;
}

/**
 * The review handoff's `## Oracle pairs` section, one table row per pair, or
 * undefined when the plan declares no oracle phase.
 */
export function renderOraclePairsSection(rows: readonly OraclePairRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  const lines = rows.map(
    (row) =>
      `| ${row.oraclePhase} | ${row.dischargingPhase} | ${row.authored} | ${row.discharged} |`,
  );
  return [
    "## Oracle pairs",
    "",
    "| Oracle phase | Discharged by | Authored | Discharged |",
    "| --- | --- | --- | --- |",
    ...lines,
  ].join("\n");
}
