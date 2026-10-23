/**
 * The hold of a run (`phax run --hold`): the grammar of its value and its
 * resolution against a plan. Pure: no I/O, and the grammar knows nothing of
 * plans.
 */
import { Either } from "effect";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import type { RunHold } from "../schemas/status.js";

export type HoldRequest =
  | { readonly kind: "none" }
  | { readonly kind: "all" }
  | { readonly kind: "oracle" }
  | { readonly kind: "listed"; readonly phases: readonly [string, ...string[]] };

const PHASE_ID = /^phase-\d{2}$/;

function refusal(value: string): string {
  const base = `--hold '${value}' is not a hold selection: give no value, oracle, or phase ids such as phase-02,phase-04`;
  // A malformed phase id (`phase-2`) is a typo, not a run name that swallowed the flag.
  const oneWord = value !== "" && !value.includes(",") && !value.startsWith("phase-");
  return oneWord
    ? `${base}\n(put the run's name before --hold, or write --hold=<selection>)`
    : base;
}

/**
 * Reads commander's value for `--hold [selection]`: `true` for a bare flag,
 * else the string given.
 */
export function parseHoldValue(value: true | string): Either.Either<HoldRequest, string> {
  if (value === true) return Either.right({ kind: "all" });
  if (value === "oracle") return Either.right({ kind: "oracle" });
  const items = value.split(",");
  if (items.includes("oracle") && items.length > 1) {
    return Either.left(`--hold '${value}' is not a hold selection: oracle stands alone`);
  }
  const [first, ...rest] = items;
  if (first === undefined || !PHASE_ID.test(first) || !rest.every((i) => PHASE_ID.test(i))) {
    return Either.left(refusal(value));
  }
  if (new Set(items).size !== items.length) return Either.left(refusal(value));
  return Either.right({ kind: "listed", phases: [first, ...rest] });
}

export interface HoldFinding {
  /** The phase the finding is about, or null for a selection-wide finding. */
  readonly phase: string | null;
  readonly message: string;
}

interface HoldPhase {
  readonly id: string;
  readonly mode: "headless" | "interactive";
  readonly oracle: PhaxPlanPhase["oracle"];
}

export type HoldResolution =
  | { readonly hold: RunHold; readonly findings: readonly [] }
  | { readonly hold: null; readonly findings: readonly HoldFinding[] };

function nonEmpty(ids: readonly string[]): readonly [string, ...string[]] | null {
  const [first, ...rest] = ids;
  return first === undefined ? null : [first, ...rest];
}

/** The ids the request selects, in plan order, with the findings it earns. */
function select(
  request: Exclude<HoldRequest, { kind: "none" }>,
  phases: readonly HoldPhase[],
): { readonly ids: readonly string[]; readonly findings: HoldFinding[] } {
  if (request.kind === "all") {
    const ids = phases
      .slice(0, -1)
      .filter((p) => p.mode === "headless")
      .map((p) => p.id);
    return ids.length > 0
      ? { ids, findings: [] }
      : {
          ids,
          findings: [
            {
              phase: null,
              message:
                "--hold selects no phase: the plan has no headless phase before its final phase",
            },
          ],
        };
  }
  if (request.kind === "oracle") {
    const ids = phases.filter((p) => p.oracle !== null).map((p) => p.id);
    return ids.length > 0
      ? { ids, findings: [] }
      : {
          ids,
          findings: [
            {
              phase: null,
              message: "--hold oracle selects no phase: the plan declares no oracle phase",
            },
          ],
        };
  }
  const findings: HoldFinding[] = [];
  const last = phases.at(-1);
  for (const id of request.phases) {
    const phase = phases.find((p) => p.id === id);
    if (phase === undefined) {
      findings.push({ phase: id, message: "is not a phase of this plan" });
    } else if (phase.mode === "interactive") {
      findings.push({
        phase: id,
        message: "is interactive: it already stops for review; remove it from --hold",
      });
    } else if (phase.id === last?.id) {
      findings.push({
        phase: id,
        message: "is the final phase: it already stays open in review_open",
      });
    }
  }
  return { ids: phases.filter((p) => request.phases.includes(p.id)).map((p) => p.id), findings };
}

/**
 * Resolves a request against the plan's phases, in plan order. `hold` is null
 * whenever there is a finding.
 */
export function resolveHold(request: HoldRequest, phases: readonly HoldPhase[]): HoldResolution {
  if (request.kind === "none") return { hold: { selection: "none" }, findings: [] };
  const { ids, findings } = select(request, phases);
  const held = nonEmpty(ids);
  if (findings.length > 0 || held === null) return { hold: null, findings };
  return { hold: { selection: request.kind, phases: held }, findings: [] };
}

/** Whether the run's recorded hold selects `phaseId`. */
export function holdsPhase(hold: RunHold, phaseId: string): boolean {
  return hold.selection !== "none" && hold.phases.includes(phaseId);
}
