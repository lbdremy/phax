import type { GateFinding } from "../../schemas/gateReport.js";
import { renderReportLocation as renderLocation } from "../reportLocation.js";
import { onOneLine } from "../reportText.js";
import {
  describeProtectedChange,
  type NonEmptyProtectedChanges,
  type ProtectedChange,
} from "../security/protectedPaths.js";

/** A configured or oracle step failed; the attempt may also have changed protected paths. */
interface StepFailurePromptInput {
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
  /** Which step failed: a configured gate step, which the agent may run, or
   *  the oracle step, which only phax runs, at the gate. */
  readonly failedStep: "configured" | "oracle";
  /** The protected paths the same attempt found changed, possibly none. */
  readonly protectedChanges: readonly ProtectedChange[];
}

/** Every step passed, yet the attempt changed protected paths. */
interface ProtectedOnlyPromptInput {
  readonly attempt: number;
  readonly failedStep: "protected-paths";
  readonly protectedChanges: NonEmptyProtectedChanges;
}

export type BuildFixPromptInput = StepFailurePromptInput | ProtectedOnlyPromptInput;

/**
 * What the agent does about protected paths: they are the operator's decision,
 * so each goes back to its content at the phase base, and the hole it was
 * meant to plug is fixed in code or the gate is left failing.
 */
const PUT_BACK: readonly string[] = [
  "The paths under **Protected paths changed** are the operator's decision: no phase of this run may change them.",
  "Put each one back to its content at the phase base: restore an edited or deleted path, remove a created one, undo a rename.",
  "Then fix the hole in the code, or leave the gate failing. If your tools cannot put a path back, say so.",
];

function requiredActionTail(failedStep: "configured" | "oracle"): string[] {
  return [
    "Make the minimum changes required to pass the gate.",
    "Do not change unrelated code or introduce new features.",
    "",
    failedStep === "oracle"
      ? "The oracles provider runs only at the gate; it will judge again after your changes. Do not run it yourself."
      : "Make sure to run the failed command after your changes to verify the gate now passes.",
    "The gate run will be re-attempted automatically after your changes.",
  ];
}

/** The `## Protected paths changed` section, one line per change, or nothing. */
function protectedSection(changes: readonly ProtectedChange[]): string[] {
  if (changes.length === 0) return [];
  return [
    "## Protected paths changed",
    "",
    ...changes.map((change) => `- ${describeProtectedChange(change)}`),
    "",
  ];
}

/** The put-back sentences closing a step failure's required action, or nothing. */
function putBackTail(changes: readonly ProtectedChange[]): string[] {
  return changes.length === 0 ? [] : ["", ...PUT_BACK];
}

/**
 * One finding: its location, marked `still failing` when the previous attempt
 * listed its id, then its rule, what was found, each related location with
 * its why, and its guide. Never its id: the id is the provider's, compared by
 * phax and never shown.
 */
function renderFinding(printed: GateFinding, stillFailing: ReadonlySet<string>): string {
  const finding = onOneLine(printed);
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
  if (input.failedStep === "protected-paths") {
    return [
      "# Gate checks failed — fix required",
      "",
      `Gate run (attempt ${input.attempt}) failed.`,
      "",
      "**Failed step:** protected paths",
      "",
      ...protectedSection(input.protectedChanges),
      "## Required action",
      "",
      ...PUT_BACK,
      "The gate run will be re-attempted automatically after your changes.",
    ].join("\n");
  }

  const {
    command,
    exitCode,
    attempt,
    logContent,
    logPath,
    reportFindings,
    stillFailing,
    protectedChanges,
  } = input;
  const tail = [...requiredActionTail(input.failedStep), ...putBackTail(protectedChanges)];

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
      ...protectedSection(protectedChanges),
      "## Required action",
      "",
      "Read the file each guide names before changing code, then fix every finding under **Findings**.",
      ...tail,
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
    ...protectedSection(protectedChanges),
    "## Required action",
    "",
    "Fix all issues revealed by the gate output above.",
    ...tail,
  ].join("\n");
}
