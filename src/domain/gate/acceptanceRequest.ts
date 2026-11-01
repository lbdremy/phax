import type { AcceptanceRequest } from "../../schemas/acceptanceRequest.js";
import type { OraclePair, OracleRole } from "../plan/oraclePairs.js";

export interface MakeAcceptanceRequestInput {
  /** The gated phase's role in its pair, from `oracleRoleOf`. */
  readonly role: OracleRole;
  /** The gated phase. */
  readonly phaseId: string;
  /** The acceptance phase's base, as noted in its status. */
  readonly base: string;
  /** The acceptance phase's commit, as noted in its status. Required at the passing phase. */
  readonly acceptanceCommit: string | null;
}

/**
 * The acceptance request for one acceptance step: `authored` at the acceptance
 * phase, `passed` at the phase that passes it. `base` is always the acceptance
 * phase's base and `files` the pair's acceptance test files in declaration
 * order. Keys come in the format's order.
 */
export function makeAcceptanceRequest(input: MakeAcceptanceRequestInput): AcceptanceRequest {
  const { role, phaseId, base, acceptanceCommit } = input;
  const files = toNonEmpty(role.pair.files, role.pair.oraclePhase);
  if (role.role === "oracle") {
    return { verdict: "authored", phase: phaseId, acceptancePhase: phaseId, base, files };
  }
  if (acceptanceCommit === null) {
    throw new Error(
      `The passed request of ${phaseId} needs the commit of ${role.pair.oraclePhase}`,
    );
  }
  return {
    verdict: "passed",
    phase: phaseId,
    acceptancePhase: role.pair.oraclePhase,
    base,
    acceptanceCommit,
    files,
  };
}

export interface MakeReviewAcceptanceRequestInput {
  /** The pair the stop sits in whose acceptance test files the corrections changed. */
  readonly pair: OraclePair;
  /** The stopped phase, which the request names as `phase`. */
  readonly phaseId: string;
  /** The acceptance phase's base, as noted in its status. */
  readonly base: string;
}

/**
 * The `authored` request a close sends when a review inside a pair changed
 * one of its acceptance test files: the acceptance phase's request, naming the
 * stopped phase as `phase`. Keys come in the format's order.
 */
export function makeReviewAcceptanceRequest(
  input: MakeReviewAcceptanceRequestInput,
): AcceptanceRequest {
  const { pair, phaseId, base } = input;
  return {
    verdict: "authored",
    phase: phaseId,
    acceptancePhase: pair.oraclePhase,
    base,
    files: toNonEmpty(pair.files, pair.oraclePhase),
  };
}

function toNonEmpty(
  files: readonly string[],
  acceptancePhase: string,
): readonly [string, ...string[]] {
  const [first, ...rest] = files;
  if (first === undefined) {
    throw new Error(`The acceptance pair of ${acceptancePhase} declares no file`);
  }
  return [first, ...rest];
}

/**
 * Names the acceptance request saved next to a gate attempt log, mirroring
 * `requestPathFor`: `checks-attempt-01.log` → `checks-attempt-01.acceptance-request.json`.
 * A path that does not end in `.log` simply gets `.acceptance-request.json` appended.
 */
export function acceptanceRequestPathFor(attemptLogPath: string): string {
  const base = attemptLogPath.endsWith(".log")
    ? attemptLogPath.slice(0, -".log".length)
    : attemptLogPath;
  return `${base}.acceptance-request.json`;
}
