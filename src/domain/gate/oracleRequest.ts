import type { OracleRequest } from "../../schemas/oracleRequest.js";
import type { OraclePair, OracleRole } from "../plan/oraclePairs.js";

export interface MakeOracleRequestInput {
  /** The gated phase's role in its pair, from `oracleRoleOf`. */
  readonly role: OracleRole;
  /** The gated phase. */
  readonly phaseId: string;
  /** The oracle phase's base, as noted in its status. */
  readonly base: string;
  /** The oracle phase's commit, as noted in its status. Required for a discharge. */
  readonly oracleCommit: string | null;
}

/**
 * The oracle request for one oracle step: `authored` at the oracle phase,
 * `discharged` at the phase that discharges it. `base` is always the oracle
 * phase's base and `files` the pair's oracle files in declaration order. Keys
 * come in the format's order.
 */
export function makeOracleRequest(input: MakeOracleRequestInput): OracleRequest {
  const { role, phaseId, base, oracleCommit } = input;
  const files = toNonEmpty(role.pair.files, role.pair.oraclePhase);
  if (role.role === "oracle") {
    return { verdict: "authored", phase: phaseId, oraclePhase: phaseId, base, files };
  }
  if (oracleCommit === null) {
    throw new Error(
      `The discharged request of ${phaseId} needs the commit of ${role.pair.oraclePhase}`,
    );
  }
  return {
    verdict: "discharged",
    phase: phaseId,
    oraclePhase: role.pair.oraclePhase,
    base,
    oracleCommit,
    files,
  };
}

export interface MakeReviewOracleRequestInput {
  /** The pair the stop sits in whose oracle files the corrections changed. */
  readonly pair: OraclePair;
  /** The stopped phase, which the request names as `phase`. */
  readonly phaseId: string;
  /** The oracle phase's base, as noted in its status. */
  readonly base: string;
}

/**
 * The `authored` request a close sends when a review inside a pair changed
 * one of its oracle files: the oracle phase's request, naming the stopped
 * phase as `phase`. Keys come in the format's order.
 */
export function makeReviewOracleRequest(input: MakeReviewOracleRequestInput): OracleRequest {
  const { pair, phaseId, base } = input;
  return {
    verdict: "authored",
    phase: phaseId,
    oraclePhase: pair.oraclePhase,
    base,
    files: toNonEmpty(pair.files, pair.oraclePhase),
  };
}

function toNonEmpty(files: readonly string[], oraclePhase: string): readonly [string, ...string[]] {
  const [first, ...rest] = files;
  if (first === undefined) throw new Error(`The oracle pair of ${oraclePhase} declares no file`);
  return [first, ...rest];
}

/**
 * Names the oracle request saved next to a gate attempt log, mirroring
 * `requestPathFor`: `checks-attempt-01.log` → `checks-attempt-01.oracle-request.json`.
 * A path that does not end in `.log` simply gets `.oracle-request.json` appended.
 */
export function oracleRequestPathFor(attemptLogPath: string): string {
  const base = attemptLogPath.endsWith(".log")
    ? attemptLogPath.slice(0, -".log".length)
    : attemptLogPath;
  return `${base}.oracle-request.json`;
}
