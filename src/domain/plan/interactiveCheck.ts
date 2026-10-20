/**
 * The `interactive` lint check: a phase's `**Mode:**` line, read from the
 * header lines of plan.md (`phaseHeader.ts`). Only an interactive phase
 * carries the line, so a typo can never run a phase headless without a word.
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

/**
 * One error per phase that declares itself interactive and has no other
 * interactive defect. The interactive-phases runtime plan replaces this with
 * the placement and planned-work rules.
 */
export function unsupportedInteractiveFindings(
  headers: readonly PhaseHeader[],
): readonly LintFinding[] {
  return headers
    .filter((h) => declaresInteractive(h) && modeDefects(h).length === 0)
    .map((h) =>
      error(
        h.phase,
        "declared interactive (**Mode:** interactive): this phax cannot run an interactive phase yet; remove the line",
      ),
    );
}

/** Every `interactive` error: malformed Mode lines, then the not-supported refusal. */
export function interactiveFindings(headers: readonly PhaseHeader[]): readonly LintFinding[] {
  return headers.flatMap((h) => [
    ...modeDefects(h).map((message) => error(h.phase, message)),
    ...unsupportedInteractiveFindings([h]),
  ]);
}
