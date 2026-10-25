import type { OverviewCoverage, OverviewPhase, PlanOverview } from "./overview.js";
import { renderTestLine } from "./testLineGrammar.js";

// The plan overview as text (test-strategy §5.13–§5.20). Pure.

type Row = readonly [label: string, value: string];

/** Rows with their labels padded to the widest one, two-space-indented. */
function renderRows(rows: readonly Row[]): string[] {
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`);
}

function oracleRoleText(role: OverviewPhase["oracleRole"]): string {
  switch (role.kind) {
    case "oracle":
      return `oracle phase, discharged by ${role.dischargedBy}`;
    case "discharging":
      return `discharges ${role.oraclePhase}`;
    case "none":
      return "none";
  }
}

function renderPhase(phase: OverviewPhase, hasParts: boolean): string[] {
  const rows: Row[] = [["oracle role", oracleRoleText(phase.oracleRole)]];
  for (const { part, files } of phase.placement) {
    if (files.length === 0) continue;
    rows.push([part ?? (hasParts ? "(no part)" : "files"), files.join(", ")]);
  }
  const lines = [
    `${phase.id} — ${phase.title}  ${phase.model} · ${phase.effort} · ${phase.mode}`,
    ...renderRows(rows),
  ];
  if (phase.placement.every((entry) => entry.files.length === 0)) {
    lines.push("  (no planned files)");
  }
  if (phase.testLines.length === 0) lines.push("  (no test lines)");
  for (const line of phase.testLines) lines.push(`  - ${renderTestLine(line)}`);
  return lines;
}

type CriterionLines = Extract<OverviewCoverage, { kind: "criteria" }>["criteria"][number]["lines"];

/**
 * The lines naming one criterion, one entry per (phase, loop) pair in order of
 * first appearance, with `×<n>` when more than one line shares the pair. The
 * JSON keeps one entry per line.
 */
function namingText(lines: CriterionLines): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const pair = `${line.phase} ${line.loop}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return [...counts]
    .map(([pair, count]) => (count === 1 ? pair : `${pair} ×${String(count)}`))
    .join(", ");
}

function renderCoverage(coverage: OverviewCoverage): string[] {
  switch (coverage.kind) {
    case "no-source-spec":
      return ["no source spec: no criterion coverage"];
    case "frontmatter-undecodable":
    case "no-criterion-ids":
      return [coverage.message];
    case "criteria": {
      const rows = coverage.criteria.map(
        (criterion): Row => [
          criterion.id,
          criterion.lines.length === 0 ? "(no test line)" : namingText(criterion.lines),
        ],
      );
      rows.push([
        "uncovered",
        coverage.uncovered.length === 0 ? "(none)" : coverage.uncovered.join(", "),
      ]);
      return [`acceptance criteria of ${coverage.slug}`, ...renderRows(rows)];
    }
  }
}

function architectureLine(architecture: PlanOverview["architecture"]): string {
  switch (architecture.kind) {
    case "parts":
      return "architecture: parts from the configured provider";
    case "none":
      return "architecture: no provider configured — planned files shown";
    case "failed":
      return "architecture: provider failed — planned files shown";
  }
}

function frontmatterText(frontmatter: PlanOverview["frontmatter"]): string {
  switch (frontmatter.kind) {
    case "decoded":
      return frontmatter.status;
    case "none":
      return "no frontmatter";
    case "undecodable":
      return `frontmatter does not decode: ${frontmatter.problem}`;
  }
}

function sourceText(overview: PlanOverview): string {
  if (overview.sourceSpec !== null) return `source spec ${overview.sourceSpec.slug}`;
  // A frontmatter that does not decode is not read for its `source-spec`.
  return overview.frontmatter.kind === "undecodable" ? "source spec not read" : "no source spec";
}

export function renderOverview(overview: PlanOverview): string {
  const lines = [
    `${overview.name} — ${overview.title}  (${frontmatterText(overview.frontmatter)} · ${sourceText(overview)})`,
    architectureLine(overview.architecture),
  ];
  const hasParts = overview.architecture.kind === "parts";
  for (const phase of overview.phases) lines.push("", ...renderPhase(phase, hasParts));
  lines.push("", ...renderCoverage(overview.coverage));
  return lines.join("\n");
}
