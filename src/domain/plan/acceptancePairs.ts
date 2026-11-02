/**
 * Acceptance pairs, resolved from `phax-plan.json`'s `acceptance` keys: each
 * non-null `acceptance` names the phase that passes it and the files it pins.
 * Pure: callers pass the plan's phases.
 */
import type { PhaxPlanPhase } from "../../schemas/phaxPlan.js";
import type { RecordAcceptanceRole } from "../../schemas/runRecord.js";
import type { PhaseStop } from "../../schemas/status.js";

export interface AcceptancePair {
  readonly acceptancePhase: string;
  readonly passingPhase: string;
  readonly files: readonly string[];
}

/** A phase's role in a pair: the acceptance phase, or the phase that passes it. */
export type AcceptanceRole =
  | { readonly role: "acceptance"; readonly pair: AcceptancePair }
  | { readonly role: "passing"; readonly pair: AcceptancePair };

type PairPhase = Pick<PhaxPlanPhase, "id" | "acceptance">;

/** Every pair of the plan, in plan order of the acceptance phase. */
export function acceptancePairs(phases: ReadonlyArray<PairPhase>): readonly AcceptancePair[] {
  return phases.flatMap((phase) =>
    phase.acceptance === null
      ? []
      : [
          {
            acceptancePhase: phase.id,
            passingPhase: phase.acceptance.passedBy,
            files: phase.acceptance.files,
          },
        ],
  );
}

/** The role `phaseId` plays in the plan's pairs, or null when it is in none. */
export function acceptanceRoleOf(
  phases: ReadonlyArray<PairPhase>,
  phaseId: string,
): AcceptanceRole | null {
  for (const pair of acceptancePairs(phases)) {
    if (pair.acceptancePhase === phaseId) return { role: "acceptance", pair };
    if (pair.passingPhase === phaseId) return { role: "passing", pair };
  }
  return null;
}

/**
 * Why `phaseId` may not skip its acceptance step (`phax resume --skip-acceptance`),
 * or null when it may: only an acceptance phase and a passing phase have one.
 */
export function acceptanceSkipRefusal(
  phases: ReadonlyArray<PairPhase>,
  phaseId: string,
): string | null {
  if (acceptanceRoleOf(phases, phaseId) !== null) return null;
  return noAcceptanceStep(phaseId);
}

function noAcceptanceStep(phaseId: string): string {
  return `--skip-acceptance: ${phaseId} is neither an acceptance phase nor a passing phase; it has no acceptance step to skip.`;
}

/**
 * Why a run awaiting review at `phaseId` may not skip an acceptance step: its
 * resume closes the stop. A stop in a pair (its acceptance phase, a phase it
 * sits in, or its passing phase) is told that a close's `authored` step is
 * never skipped; a stop in no pair has no acceptance step at all, as
 * `acceptanceSkipRefusal` says.
 */
export function stopSkipAcceptanceRefusal(
  phases: ReadonlyArray<PairPhase>,
  run: string,
  phaseId: string,
): string {
  const inPair =
    acceptanceRoleOf(phases, phaseId) !== null || stopAcceptancePairs(phases, phaseId).length > 0;
  if (!inPair) return noAcceptanceStep(phaseId);
  return `--skip-acceptance: ${run} awaits review at ${phaseId}; a close's authored acceptance step is never skipped. Undo the acceptance-test-file correction, or reset the stop.`;
}

/**
 * The acceptance test files `phaseId` passes: its pair's files when it is a
 * passing phase, else none. Reconciliation counts them as optional files, so
 * removing a marker is never an unplanned edit.
 */
export function passedAcceptanceTestFiles(
  phases: ReadonlyArray<PairPhase>,
  phaseId: string,
): readonly string[] {
  const role = acceptanceRoleOf(phases, phaseId);
  return role?.role === "passing" ? role.pair.files : [];
}

/**
 * The pairs a stop at `stopPhaseId` sits in: those whose acceptance phase is
 * the stop or comes before it, and whose passing phase comes after it. A
 * passing phase is never in its own pair's list: its pass was judged before it
 * stopped.
 */
export function stopAcceptancePairs(
  phases: ReadonlyArray<PairPhase>,
  stopPhaseId: string,
): readonly AcceptancePair[] {
  const indexOf = (id: string): number => phases.findIndex((p) => p.id === id);
  const stop = indexOf(stopPhaseId);
  if (stop === -1) return [];
  return acceptancePairs(phases).filter(
    (pair) => indexOf(pair.acceptancePhase) <= stop && indexOf(pair.passingPhase) > stop,
  );
}

/** The pairs whose acceptance test files include one of `changedPaths`. */
export function pairsChangedByCorrections(
  pairs: readonly AcceptancePair[],
  changedPaths: readonly string[],
): readonly AcceptancePair[] {
  return pairs.filter((pair) => pair.files.some((file) => changedPaths.includes(file)));
}

/** The status.json facts the latest authored commit is read from. */
export interface AuthoredCommitStatus {
  readonly phaseId: string;
  readonly commitHash?: string | undefined;
  readonly stop: PhaseStop;
}

/**
 * The commit a pair's passing phase judges, from status.json facts only: the
 * last phase in plan order, from the acceptance phase up to but not including
 * the passing phase, whose closed stop corrected something and ran the
 * `authored` step (its `reviewCommit` when held, its `commitHash` when
 * declared). Without one, the acceptance phase's `commitHash`, or null when it
 * noted none.
 */
export function latestAuthoredCommit(
  pair: AcceptancePair,
  phases: ReadonlyArray<PairPhase>,
  statuses: readonly AuthoredCommitStatus[],
): string | null {
  const from = phases.findIndex((p) => p.id === pair.acceptancePhase);
  const to = phases.findIndex((p) => p.id === pair.passingPhase);
  const statusOf = (id: string) => statuses.find((s) => s.phaseId === id);
  for (const phase of phases.slice(from, to).toReversed()) {
    const status = statusOf(phase.id);
    const stop = status?.stop ?? null;
    if (stop === null || stop.status !== "closed" || stop.outcome !== "corrected") continue;
    if (stop.acceptanceStep !== "authored") continue;
    if (stop.cause === "held") return stop.reviewCommit;
    if (status?.commitHash !== undefined) return status.commitHash;
  }
  return statusOf(pair.acceptancePhase)?.commitHash ?? null;
}

/** The role as a phase record's manifest stores it. */
export function recordAcceptanceRole(role: AcceptanceRole | null): RecordAcceptanceRole {
  if (role === null) return null;
  return role.role === "acceptance"
    ? { role: "acceptance", passedBy: role.pair.passingPhase }
    : { role: "passing", acceptancePhase: role.pair.acceptancePhase };
}

/** The last acceptance-step result of one side of a pair, `not run` when it has none. */
export type AcceptancePairResult = "pass" | "fail" | "refused" | "skipped" | "not run";

export interface AcceptancePairRow {
  readonly acceptancePhase: string;
  readonly passingPhase: string;
  readonly authored: AcceptancePairResult;
  readonly passed: AcceptancePairResult;
}

/**
 * The review handoff's pairs section, one table row per pair, or undefined
 * when the plan declares no acceptance phase.
 */
export function renderAcceptancePairsSection(
  rows: readonly AcceptancePairRow[],
): string | undefined {
  if (rows.length === 0) return undefined;
  const lines = rows.map(
    (row) => `| ${row.acceptancePhase} | ${row.passingPhase} | ${row.authored} | ${row.passed} |`,
  );
  return [
    "## Acceptance pairs",
    "",
    "| Acceptance phase | Passed by | Authored | Passed |",
    "| --- | --- | --- | --- |",
    ...lines,
  ].join("\n");
}
