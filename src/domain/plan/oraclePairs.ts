/**
 * Oracle pairs (oracle-phases), resolved from `phax-plan.json`'s `oracle` keys:
 * each non-null `oracle` names the phase that discharges it and the files it
 * pins. Pure: callers pass the plan's phases.
 */
import type { PhaxPlanPhase } from "../../schemas/phaxPlan.js";
import type { RecordOracleRole } from "../../schemas/runRecord.js";
import type { PhaseStop } from "../../schemas/status.js";

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
 * Why `phaseId` may not skip its oracle step (`phax resume --skip-oracle`), or
 * null when it may: only an oracle phase and a discharging phase have one.
 */
export function oracleSkipRefusal(
  phases: ReadonlyArray<PairPhase>,
  phaseId: string,
): string | null {
  if (oracleRoleOf(phases, phaseId) !== null) return null;
  return noOracleStep(phaseId);
}

function noOracleStep(phaseId: string): string {
  return `--skip-oracle: ${phaseId} is neither an oracle phase nor a discharging phase; it has no oracle step to skip.`;
}

/**
 * Why a run awaiting review at `phaseId` may not skip an oracle step: its
 * resume closes the stop. A stop in a pair (its oracle phase, a phase it sits
 * in, or its discharging phase) is told that a close's `authored` step is
 * never skipped; a stop in no pair has no oracle step at all, as
 * `oracleSkipRefusal` says.
 */
export function stopSkipOracleRefusal(
  phases: ReadonlyArray<PairPhase>,
  run: string,
  phaseId: string,
): string {
  const inPair =
    oracleRoleOf(phases, phaseId) !== null || stopOraclePairs(phases, phaseId).length > 0;
  if (!inPair) return noOracleStep(phaseId);
  return `--skip-oracle: ${run} awaits review at ${phaseId}; a close's authored oracle step is never skipped. Undo the oracle-file correction, or reset the stop.`;
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

/**
 * The pairs a stop at `stopPhaseId` sits in: those whose oracle phase is the
 * stop or comes before it, and whose discharging phase comes after it. A
 * discharging phase is never in its own pair's list: its discharge was judged
 * before it stopped.
 */
export function stopOraclePairs(
  phases: ReadonlyArray<PairPhase>,
  stopPhaseId: string,
): readonly OraclePair[] {
  const indexOf = (id: string): number => phases.findIndex((p) => p.id === id);
  const stop = indexOf(stopPhaseId);
  if (stop === -1) return [];
  return oraclePairs(phases).filter(
    (pair) => indexOf(pair.oraclePhase) <= stop && indexOf(pair.dischargingPhase) > stop,
  );
}

/** The pairs whose oracle files include one of `changedPaths`. */
export function pairsChangedByCorrections(
  pairs: readonly OraclePair[],
  changedPaths: readonly string[],
): readonly OraclePair[] {
  return pairs.filter((pair) => pair.files.some((file) => changedPaths.includes(file)));
}

/** The status.json facts the latest authored commit is read from. */
export interface AuthoredCommitStatus {
  readonly phaseId: string;
  readonly commitHash?: string | undefined;
  readonly stop: PhaseStop;
}

/**
 * The commit a pair's discharge judges, from status.json facts only: the last
 * phase in plan order, from the oracle phase up to but not including the
 * discharge, whose closed stop corrected something and ran the `authored`
 * step (its `reviewCommit` when held, its `commitHash` when declared).
 * Without one, the oracle phase's `commitHash`, or null when it noted none.
 */
export function latestAuthoredCommit(
  pair: OraclePair,
  phases: ReadonlyArray<PairPhase>,
  statuses: readonly AuthoredCommitStatus[],
): string | null {
  const from = phases.findIndex((p) => p.id === pair.oraclePhase);
  const to = phases.findIndex((p) => p.id === pair.dischargingPhase);
  const statusOf = (id: string) => statuses.find((s) => s.phaseId === id);
  for (const phase of phases.slice(from, to).toReversed()) {
    const status = statusOf(phase.id);
    const stop = status?.stop ?? null;
    if (stop === null || stop.status !== "closed" || stop.outcome !== "corrected") continue;
    if (stop.oracleStep !== "authored") continue;
    if (stop.cause === "held") return stop.reviewCommit;
    if (status?.commitHash !== undefined) return status.commitHash;
  }
  return statusOf(pair.oraclePhase)?.commitHash ?? null;
}

/** The role as a phase record's manifest stores it. */
export function recordOracleRole(role: OracleRole | null): RecordOracleRole {
  if (role === null) return null;
  return role.role === "oracle"
    ? { role: "oracle", dischargedBy: role.pair.dischargingPhase }
    : { role: "discharging", oraclePhase: role.pair.oraclePhase };
}

/** The last oracle-step result of one side of a pair, `not run` when it has none. */
export type OraclePairResult = "pass" | "fail" | "refused" | "skipped" | "not run";

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
