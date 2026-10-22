/**
 * The `interactive` lint check: a phase's `**Mode:**` line, read from the
 * header lines of plan.md (`phaseHeader.ts`), where an interactive phase may
 * sit, and that it plans no work. Only an interactive phase carries the line,
 * so a typo can never run a phase headless without a word. `phax plans lint`
 * and the run preflight both call `interactiveFindings`, so a lint error is
 * the preflight's refusal.
 */
import type { LintFinding } from "./lint.js";
import { declaresInteractive, type PhaseHeader } from "./phaseHeader.js";

function error(phase: string, message: string): LintFinding {
  return { severity: "error", check: "interactive", phase, message };
}

function modeDefects(header: PhaseHeader): readonly string[] {
  const defects: string[] = [];
  if (header.mode !== null && header.mode !== "interactive") {
    defects.push(
      `**Mode:** "${header.mode}" is not a mode: only an interactive phase carries a Mode line (**Mode:** interactive); a headless phase carries no Mode line`,
    );
  }
  if (header.repeated.includes("Mode")) {
    defects.push("**Mode:** line appears more than once in the header paragraph");
  }
  if (header.misplaced.includes("Mode")) {
    defects.push("**Mode:** line sits outside the header paragraph");
  }
  return defects;
}

/** The planned files of a parsed phase, which an interactive phase must leave empty. */
export interface InteractiveCheckPhase {
  readonly id: string;
  readonly plannedFilesToCreate: readonly string[];
  readonly plannedFilesToEdit: readonly string[];
}

export interface InteractiveCheckInput {
  /** The `## phase-NN` headings of plan.md, in plan order. */
  readonly headers: readonly PhaseHeader[];
  /** The parsed plan's phases, or null when lint could not parse the plan. */
  readonly phases: readonly InteractiveCheckPhase[] | null;
}

// Where an interactive phase may sit: never first (no pattern is set yet),
// never last (the final phase is already kept open), never right after
// another one. First and last rows come before the following rows.
function placementFindings(headers: readonly PhaseHeader[]): readonly LintFinding[] {
  const first = headers[0];
  const last = headers.length > 1 ? headers[headers.length - 1] : undefined;
  return [
    ...(first !== undefined && declaresInteractive(first)
      ? [
          error(
            first.phase,
            "an interactive phase cannot be the first phase (no earlier phase has set a pattern to review)",
          ),
        ]
      : []),
    ...(last !== undefined && declaresInteractive(last)
      ? [
          error(
            last.phase,
            "an interactive phase cannot be the last phase (the final phase is already kept open)",
          ),
        ]
      : []),
    ...headers.flatMap((h, i) => {
      const previous = i > 0 ? headers[i - 1] : undefined;
      return previous !== undefined && declaresInteractive(h) && declaresInteractive(previous)
        ? [error(h.phase, `directly follows interactive ${previous.phase}`)]
        : [];
    }),
  ];
}

// One row per planned file of an interactive phase: the person's corrections
// are its only work, and its optional files may name what they touch.
function plannedWorkFindings(
  headers: readonly PhaseHeader[],
  phases: readonly InteractiveCheckPhase[] | null,
): readonly LintFinding[] {
  if (phases === null) return [];
  const interactive = new Set(headers.filter(declaresInteractive).map((h) => h.phase));
  return phases
    .filter((p) => interactive.has(p.id))
    .flatMap((p) => [
      ...p.plannedFilesToCreate.map((f) =>
        error(p.id, `plans ${f} to create; an interactive phase plans no work`),
      ),
      ...p.plannedFilesToEdit.map((f) =>
        error(p.id, `plans ${f} to edit; an interactive phase plans no work`),
      ),
    ]);
}

/**
 * Every `interactive` error, in order: the malformed Mode lines, the
 * placement rule (read from the headers), then the planned-work rule, which
 * reports nothing when `phases` is null.
 */
export function interactiveFindings(input: InteractiveCheckInput): readonly LintFinding[] {
  const { headers, phases } = input;
  return [
    ...headers.flatMap((h) => modeDefects(h).map((message) => error(h.phase, message))),
    ...placementFindings(headers),
    ...plannedWorkFindings(headers, phases),
  ];
}
