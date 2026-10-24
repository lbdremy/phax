import type { InteractiveHandoffSummary } from "./handoff.js";

// A stopped phase as the review surfaces show it. Pure: no I/O.

export interface ReviewedPhase {
  readonly phaseId: string;
  readonly cause: "declared" | "held";
  readonly outcome: "corrected" | "unchanged";
  readonly closedBy: { readonly name: string; readonly email: string };
  readonly summary: InteractiveHandoffSummary;
}

// A held stop is shown as `held`, a declared one as `interactive`.
function causeLabel(phase: ReviewedPhase): "held" | "interactive" {
  return phase.cause === "held" ? "held" : "interactive";
}

function guardsCell(phase: ReviewedPhase): string {
  if (phase.outcome === "unchanged") return "—";
  const { guards, noGuard } = phase.summary;
  return noGuard.length === 0
    ? `${guards.length}`
    : `${guards.length} (${noGuard.length} no guard)`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\r?\n\s*/g, " ");
}

/**
 * The review handoff's `## Reviewed phases`: a table of each stop, then the
 * corrections and guards of each corrected stop. Empty when no phase stopped.
 */
export function renderReviewedPhases(phases: readonly ReviewedPhase[]): string {
  if (phases.length === 0) return "";
  const rows = phases.map(
    (p) =>
      `| ${cell(p.phaseId)} | ${causeLabel(p)} | ${p.outcome} | ${cell(p.closedBy.name)} | ${
        p.outcome === "unchanged" ? 0 : p.summary.corrections.length
      } | ${guardsCell(p)} |`,
  );
  const details = phases
    .filter((p) => p.outcome === "corrected")
    .flatMap((p) => [
      `### ${p.phaseId} (${causeLabel(p)})`,
      "",
      "#### What was corrected",
      "",
      p.summary.correctedSection,
      "",
      "#### Guards",
      "",
      p.summary.guardsSection,
      "",
    ]);
  return [
    "## Reviewed phases",
    "",
    "| Phase | Stop | Outcome | Closed by | Corrections | Guards |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...details,
  ]
    .join("\n")
    .trimEnd();
}

/** The suffix of a stopped phase's line in the PR body. */
export function prPhaseStopSuffix(phase: ReviewedPhase): string {
  const label = causeLabel(phase);
  const by = phase.closedBy.name;
  if (phase.outcome === "unchanged") return ` · ${label}, reviewed without change by ${by}`;
  const n = phase.summary.guards.length;
  return ` · ${label}, corrected by ${by} (${n} ${n === 1 ? "guard" : "guards"})`;
}
