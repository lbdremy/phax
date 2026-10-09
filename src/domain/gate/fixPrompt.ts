import type { GateDiagnostic } from "../../schemas/gateDiagnostics.js";
import type { GateFinding } from "../../schemas/gateReport.js";
import type { ReportLocation, ReportRelatedLocation } from "../../schemas/report.js";

export interface BuildFixPromptInput {
  readonly command: string;
  readonly exitCode: number;
  readonly attempt: number;
  readonly logContent: string;
  readonly logPath: string;
  readonly diagnostics: readonly GateDiagnostic[];
  /** The findings of the checked gate report that failed the step, or null:
   *  a log step or a broken step gets the raw-log prompt. */
  readonly reportFindings: {
    readonly step: number;
    readonly findings: readonly GateFinding[];
  } | null;
}

const REQUIRED_ACTION_TAIL = [
  "Make the minimum changes required to pass the gate.",
  "Do not change unrelated code or introduce new features.",
  "",
  "Make sure to run the failed command after your changes to verify the gate now passes.",
  "The gate run will be re-attempted automatically after your changes.",
];

function renderDiagnostic(diagnostic: GateDiagnostic): string {
  const location =
    diagnostic.location.line === undefined
      ? diagnostic.location.file
      : `${diagnostic.location.file}:${diagnostic.location.line}`;
  return [
    `- ${diagnostic.rule} at ${location} — ${diagnostic.message}`,
    `  repair guide: ${diagnostic.repair}`,
  ].join("\n");
}

/** `file`, `file:N` when the lines start and end on one line, or `file:N-M`. */
function renderLocation(location: ReportLocation | ReportRelatedLocation): string {
  if (location.lines === null) return location.file;
  const [start, end] = location.lines;
  return start === end ? `${location.file}:${start}` : `${location.file}:${start}-${end}`;
}

/**
 * One finding: its location, then its rule, what was found, each related
 * location with its why, and its guide. Never its id: the id is the
 * provider's, compared by phax and never shown.
 */
function renderFinding(finding: GateFinding): string {
  return [
    `- ${renderLocation(finding.location)}`,
    `  rule: ${finding.rule}`,
    `  found: ${finding.message}`,
    ...finding.related.map(
      (related) => `  also involves ${renderLocation(related)} — ${related.why}`,
    ),
    ...(finding.guide === null
      ? []
      : [`  guide: ${finding.guide.summary}. Read ${finding.guide.read} and follow it.`]),
  ].join("\n");
}

export function buildFixPrompt(input: BuildFixPromptInput): string {
  const { command, exitCode, attempt, logContent, logPath, diagnostics, reportFindings } = input;

  if (reportFindings !== null) {
    const { findings } = reportFindings;
    const count = findings.length === 1 ? "1 finding" : `${findings.length} findings`;
    return [
      "# Gate checks failed — fix required",
      "",
      `Gate run (attempt ${attempt}) failed.`,
      "",
      `**Failed step:** \`${command}\` (${count})`,
      "",
      "## Findings",
      "",
      findings.map(renderFinding).join("\n"),
      "",
      `Full output: ${logPath}`,
      "",
      "## Required action",
      "",
      "Read the file each guide names before changing code, then fix every finding under **Findings**.",
      ...REQUIRED_ACTION_TAIL,
    ].join("\n");
  }

  if (diagnostics.length === 0) {
    return [
      "# Gate checks failed — fix required",
      "",
      `Gate run (attempt ${attempt}) failed.`,
      "",
      `**Failed command:** \`${command}\``,
      `**Exit code:** ${exitCode}`,
      "",
      "## Gate output",
      "",
      "```",
      logContent,
      "```",
      "",
      "## Required action",
      "",
      "Fix all issues revealed by the gate output above.",
      ...REQUIRED_ACTION_TAIL,
    ].join("\n");
  }

  return [
    "# Gate checks failed — fix required",
    "",
    `Gate run (attempt ${attempt}) failed.`,
    "",
    `**Failed step:** \`${command}\` (${diagnostics.length} diagnostic(s))`,
    "",
    "## Diagnostics",
    "",
    diagnostics.map(renderDiagnostic).join("\n"),
    "",
    `Full output: ${logPath}`,
    "",
    "## Required action",
    "",
    "Read each repair guide above before changing code, then fix every diagnostic listed under **Diagnostics**.",
    ...REQUIRED_ACTION_TAIL,
  ].join("\n");
}
