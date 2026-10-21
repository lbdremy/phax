/**
 * The bounds check: holds every phase to its governing assignment bound, or to
 * the policy default when no bound governs it. Pure: the architecture
 * report's parts arrive already resolved (`PartResolution`, built by the app
 * layer), and nothing here ranks, writes or changes a model or an effort.
 *
 * `phax plans lint` reports every finding; the `phax run` / `phax resume`
 * start preflight refuses on the errors among them.
 */
import type { Assignments, AssignmentBound } from "../../schemas/assignments.js";
import type { Effort } from "../../schemas/phaxPlan.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { matchesAnyGlob } from "../architecture/glob.js";
import { entryFor } from "../routing/catalog.js";
import { PHASE_MODEL_POLICY } from "../routing/phaseModelPolicy.js";
import type { LintFinding } from "./lint.js";
import type { PhaseHeader } from "./phaseHeader.js";

/** The architecture report's parts as the bounds need them: part id to globs. */
export type PartResolution =
  | { readonly kind: "resolved"; readonly parts: ReadonlyMap<string, readonly string[]> }
  | { readonly kind: "unavailable"; readonly cause: string };

/** What the check reads of a phase. */
export interface BoundedPhase {
  readonly id: string;
  readonly model: string;
  readonly effort: Effort;
  readonly plannedFilesToCreate: readonly string[];
  readonly plannedFilesToEdit: readonly string[];
  readonly optionalFilesToEdit: readonly string[];
}

// The bound's efforts from `min` to `max`, in its model's catalog order, or
// the one problem that keeps them from being read.
function boundEfforts(
  bound: AssignmentBound,
  index: number,
  providerConfig: ProviderConfig,
): { readonly efforts: readonly string[] } | { readonly problem: string } {
  const field = `assignments[${index}]`;
  const location = entryFor(bound.model, providerConfig);
  if (location === undefined) {
    return { problem: `${field}.model: ${bound.model} is not in the catalog` };
  }
  const order: readonly string[] = location.entry.efforts;
  const { min, max } = bound.effort;
  for (const [end, effort] of [
    ["min", min],
    ["max", max],
  ] as const) {
    if (!order.includes(effort)) {
      return {
        problem: `${field}.effort: ${end} "${effort}" is not an effort ${bound.model} offers`,
      };
    }
  }
  const from = order.indexOf(min);
  const to = order.indexOf(max);
  if (from > to) {
    return {
      problem: `${field}.effort: min "${min}" comes after max "${max}" for ${bound.model}`,
    };
  }
  return { efforts: order.slice(from, to + 1) };
}

/**
 * One message per bound the routing catalog does not admit, in list order:
 * an unknown model, a `min` or `max` the model does not offer, or a `min`
 * after `max` in the model's catalog effort order.
 */
export function boundCatalogProblems(
  bounds: Assignments,
  providerConfig: ProviderConfig,
): readonly string[] {
  return bounds.flatMap((bound, index) => {
    const read = boundEfforts(bound, index, providerConfig);
    return "problem" in read ? [read.problem] : [];
  });
}

function rangeText(bound: AssignmentBound): string {
  const { min, max } = bound.effort;
  return min === max ? min : `${min}–${max}`;
}

/** `assignments[N] (part <id>: <model>, <min>–<max>)` or `assignments[N] (globs <g>, …: …)`. */
function boundText(bound: AssignmentBound, index: number): string {
  const covers = bound.kind === "part" ? `part ${bound.part}` : `globs ${bound.globs.join(", ")}`;
  return `assignments[${index}] (${covers}: ${bound.model}, ${rangeText(bound)})`;
}

const REASON_LINE = "**Assignment reason:** line";

function boundError(message: string): LintFinding {
  return { severity: "error", check: "models", phase: null, message };
}

/**
 * The `models` findings of the bounds over a plan's phases.
 *
 * With bounds declared, a bound the catalog does not admit, or a part bound
 * whose part is not resolved, is an error with no phase, and when there is
 * any such error no phase is compared at all. Otherwise each phase's
 * governing bound is the first, in list order, that matches any of its
 * planned files (create, edit and optional). The phase conforms when it takes
 * the bound's model at an effort within the range: an unstated departure is
 * an error, a stated one a warning quoting the reason, and a conforming phase
 * with a reason a warning. A phase no bound governs (every phase when none
 * is declared, and a phase with no planned file) is compared with the policy
 * default, as warnings only. The reason is the header's `assignmentReason`.
 */
export function assignmentFindings(input: {
  readonly bounds: Assignments | undefined;
  readonly phases: readonly BoundedPhase[];
  readonly headers: readonly PhaseHeader[];
  readonly parts: PartResolution;
  readonly providerConfig: ProviderConfig;
}): LintFinding[] {
  const { bounds, phases, headers, parts, providerConfig } = input;

  const governing: {
    readonly bound: AssignmentBound;
    readonly index: number;
    readonly globs: readonly string[];
    readonly efforts: readonly string[];
  }[] = [];
  const boundErrors: LintFinding[] = [];
  for (const [index, bound] of (bounds ?? []).entries()) {
    const read = boundEfforts(bound, index, providerConfig);
    if ("problem" in read) boundErrors.push(boundError(read.problem));
    let globs: readonly string[] | undefined;
    if (bound.kind === "globs") {
      globs = bound.globs;
    } else {
      globs = parts.kind === "resolved" ? parts.parts.get(bound.part) : undefined;
      if (globs === undefined) {
        const cause =
          parts.kind === "unavailable"
            ? parts.cause
            : `the architecture report has no part ${bound.part}`;
        boundErrors.push(
          boundError(
            `assignments[${index}] (part ${bound.part}): unresolved: ${cause}; no phase was compared with the bounds`,
          ),
        );
      }
    }
    if (globs !== undefined && "efforts" in read) {
      governing.push({ bound, index, globs, efforts: read.efforts });
    }
  }
  if (boundErrors.length > 0) return boundErrors;

  const findings: LintFinding[] = [];
  const { model: defaultModel, effort: defaultEffort } = PHASE_MODEL_POLICY.defaultAssignment;
  const policyDefault = `the policy default (${defaultModel} / ${defaultEffort})`;
  for (const phase of phases) {
    const reason = headers.find((h) => h.phase === phase.id)?.assignmentReason ?? null;
    const files = [
      ...phase.plannedFilesToCreate,
      ...phase.plannedFilesToEdit,
      ...phase.optionalFilesToEdit,
    ];
    const taken = `${phase.model} / ${phase.effort}`;
    const finding = (severity: LintFinding["severity"], message: string): LintFinding => ({
      severity,
      check: "models",
      phase: phase.id,
      message,
    });

    const governed = governing.find((g) => matchesAnyGlob(g.globs, files));
    if (governed !== undefined) {
      const bound = boundText(governed.bound, governed.index);
      const conforms =
        phase.model === governed.bound.model && governed.efforts.includes(phase.effort);
      if (conforms) {
        if (reason !== null) {
          findings.push(finding("warning", `conforms to ${bound} but carries an ${REASON_LINE}`));
        }
      } else if (reason === null) {
        findings.push(finding("error", `${taken}: outside ${bound} with no ${REASON_LINE}`));
      } else {
        findings.push(finding("warning", `${taken}: outside ${bound}: "${reason}"`));
      }
      continue;
    }

    const atDefault = phase.model === defaultModel && phase.effort === defaultEffort;
    if (!atDefault && reason === null) {
      findings.push(
        finding(
          "warning",
          `${taken}: no bound governs; departs from ${policyDefault} with no ${REASON_LINE}`,
        ),
      );
    } else if (atDefault && reason !== null) {
      findings.push(
        finding(
          "warning",
          `no bound governs; takes ${policyDefault} but carries an ${REASON_LINE}`,
        ),
      );
    }
  }
  return findings;
}
