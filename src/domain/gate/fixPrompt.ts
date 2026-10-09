import type { GateFinding } from "../../schemas/gateReport.js";
import type { ReportLocation, ReportRelatedLocation } from "../../schemas/report.js";

export interface BuildFixPromptInput {
  readonly command: string;
  readonly exitCode: number;
  readonly attempt: number;
  readonly logContent: string;
  readonly logPath: string;
  /** The findings of the checked gate report that failed the step, or null:
   *  a log step or a broken step gets the raw-log prompt. */
  readonly reportFindings: {
    readonly step: number;
    readonly findings: readonly GateFinding[];
  } | null;
  /** The ids the same step's checked report listed in the phase's previous
   *  gate attempt: each finding with one of them is marked `still failing`. */
  readonly stillFailing: ReadonlySet<string>;
}

const REQUIRED_ACTION_TAIL = [
  "Make the minimum changes required to pass the gate.",
  "Do not change unrelated code or introduce new features.",
  "",
  "Make sure to run the failed command after your changes to verify the gate now passes.",
  "The gate run will be re-attempted automatically after your changes.",
];

/** `file`, `file:N` when the lines start and end on one line, or `file:N-M`. */
function renderLocation(location: ReportLocation | ReportRelatedLocation): string {
  if (location.lines === null) return location.file;
  const [start, end] = location.lines;
  return start === end ? `${location.file}:${start}` : `${location.file}:${start}-${end}`;
}

/**
 * One finding: its location, marked `still failing` when the previous attempt
 * listed its id, then its rule, what was found, each related location with
 * its why, and its guide. Never its id: the id is the provider's, compared by
 * phax and never shown.
 */
function renderFinding(finding: GateFinding, stillFailing: ReadonlySet<string>): string {
  const mark = stillFailing.has(finding.id) ? " · still failing" : "";
  return [
    `- ${renderLocation(finding.location)}${mark}`,
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
  const { command, exitCode, attempt, logContent, logPath, reportFindings, stillFailing } = input;

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
      findings.map((finding) => renderFinding(finding, stillFailing)).join("\n"),
      "",
      `Full output: ${logPath}`,
      "",
      "## Required action",
      "",
      "Read the file each guide names before changing code, then fix every finding under **Findings**.",
      ...REQUIRED_ACTION_TAIL,
    ].join("\n");
  }

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
