import type { ArchitectureReport } from "../../schemas/architecture.js";
import type { AssignmentBound, Assignments } from "../../schemas/assignments.js";
import { onOneLine } from "../reportText.js";

/**
 * An architecture report as Markdown: the body as is (trailing newlines
 * stripped), then, when the report has parts, a `## Parts` section with one
 * `### name (`id`)` entry per part, in the report's order. Name and
 * description are folded onto one line; no trailing newline.
 */
export function renderArchitectureReport(report: ArchitectureReport): string {
  let out = report.body.replace(/\n+$/, "");
  if (report.parts.length === 0) return out;
  out += "\n\n## Parts";
  for (const part of report.parts) {
    out += `\n\n### ${onOneLine(part.name)} (\`${part.id}\`)\n${onOneLine(part.description)}`;
    for (const glob of part.globs) out += `\n- \`${glob}\``;
  }
  return out;
}

/** Where the bounds section reads its parts from. */
export type AssignmentBoundsSource =
  | { readonly kind: "report"; readonly report: ArchitectureReport; readonly scoped: boolean }
  | { readonly kind: "no-provider" };

function codeSpans(globs: readonly string[]): string {
  return globs.map((glob) => `\`${glob}\``).join(", ");
}

function renderRange(bound: AssignmentBound): string {
  const { min, max } = bound.effort;
  return min === max ? min : `${min}–${max}`;
}

function renderPartTarget(partId: string, source: AssignmentBoundsSource): string {
  if (source.kind === "no-provider") return "(unresolved: no architecture provider)";
  const part = source.report.parts.find((candidate) => candidate.id === partId);
  if (part !== undefined) return `${onOneLine(part.name)} (${codeSpans(part.globs)})`;
  return source.scoped
    ? "(not in this report: run `phax architecture` with no path for its globs)"
    : `(unresolved: the report has no part ${partId})`;
}

/**
 * The owner's assignment bounds as Markdown: a heading, then one line per bound
 * in list order. A part bound shows its part's name and globs when the report
 * carries the part, and says why it does not otherwise. No trailing newline.
 */
export function renderAssignmentBounds(
  bounds: Assignments,
  source: AssignmentBoundsSource,
): string {
  let out = "## Bounds (phax.json `assignments`; the first match governs)";
  bounds.forEach((bound, index) => {
    const target =
      bound.kind === "part"
        ? `part ${bound.part} — ${renderPartTarget(bound.part, source)}`
        : `globs ${codeSpans(bound.globs)}`;
    out += `\n- assignments[${index}] ${target}: ${bound.model}, ${renderRange(bound)}`;
  });
  return out;
}
