import type { LintFinding } from "./lint.js";

export interface RenderableLintReport {
  readonly plan: string;
  readonly findings: readonly LintFinding[];
}

// Widest member of each closed set, so the columns never ragged-shift.
const SEVERITY_WIDTH = "warning".length;
const CHECK_WIDTH = "structure".length;
const PHASE_WIDTH = "phase-NN".length;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Renders a lint report as the spec 33 §6 sketch: a header line counting the
 * findings, then one line per finding. The header is the normative part; the
 * columns are indicative.
 */
export function renderLintReport(report: RenderableLintReport): string {
  const { plan, findings } = report;
  if (findings.length === 0) return `${plan}: no findings`;

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;

  const lines = [`${plan}: ${plural(errors, "error")}, ${plural(warnings, "warning")}`];
  for (const finding of findings) {
    lines.push(
      [
        finding.severity.padEnd(SEVERITY_WIDTH),
        finding.check.padEnd(CHECK_WIDTH),
        (finding.phase ?? "-").padEnd(PHASE_WIDTH),
        finding.message,
      ].join("  "),
    );
  }
  return lines.join("\n");
}
