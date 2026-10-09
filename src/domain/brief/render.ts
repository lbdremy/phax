import type { BriefPush } from "../../schemas/phaxConfig.js";
import type { BriefFinding, BriefReport, BriefRule } from "../../schemas/briefReport.js";
import type { ReportGuide } from "../../schemas/report.js";
import { renderReportLocation } from "../reportLocation.js";

/** The most item lines the pushed brief shows; `phax brief` prints the rest. */
export const BRIEF_PUSH_CAP = 50;

const HEADING = "## Brief for this phase";

const INTRO: { readonly [P in BriefPush]: string } = {
  findings:
    "What fails in this phase's planned files and is due in this phase, in the provider's order. It informs; the gate decides.",
  "findings-and-rules":
    "What fails in this phase's planned files and is due in this phase, then the rules over those files, in the provider's order. It informs; the gate decides.",
};

const NOTHING_LISTED: { readonly [P in BriefPush]: string } = {
  findings: "Nothing in this phase's planned files is due in this phase.",
  "findings-and-rules": "The brief lists nothing for this phase's planned files.",
};

// The three instructions every variant of the section ends with.
const INSTRUCTIONS = [
  "Before touching any file, planned or not, existing or not yet created, run `phax brief <path> [<path>…]` to see the rules over it, what fails there and how to fix it.",
  "`phax brief` with no path prints this phase's brief whole, as the code stands now.",
  "To learn where the phase stands, run the gate commands listed under Execution rules. The brief never fails the phase.",
];

/** ` · guide: <summary> (read <read>)`, or nothing when there is no guide. */
function guideSuffix(guide: ReportGuide | null): string {
  return guide === null ? "" : ` · guide: ${guide.summary} (read ${guide.read})`;
}

/** One finding in compact form: location, rule, message, then its guide. Never its id. */
function findingLine(finding: BriefFinding): string {
  return `- ${renderReportLocation(finding.location)} — ${finding.rule} — ${finding.message}${guideSuffix(finding.guide)}`;
}

/** One rule in compact form: the rule, its files, then its guide. */
function ruleLine(rule: BriefRule): string {
  return `- rule: ${rule.rule} — ${rule.files.join(", ")}${guideSuffix(rule.guide)}`;
}

/**
 * The pushed items, at most `BRIEF_PUSH_CAP` lines then one overflow line:
 * the findings due this phase in the provider's order, then, with
 * `findings-and-rules` only, the rules in the provider's order. A finding due
 * later, or with no due, is never pushed. One line when nothing is listed.
 */
function answeredBody(report: BriefReport, push: BriefPush): readonly string[] {
  const items = [
    ...report.findings.filter((finding) => finding.due === "this-phase").map(findingLine),
    ...(push === "findings-and-rules" ? report.rules.map(ruleLine) : []),
  ];
  if (items.length === 0) return [NOTHING_LISTED[push]];
  const shown = items.slice(0, BRIEF_PUSH_CAP);
  const hidden = items.length - shown.length;
  return hidden > 0
    ? [...shown, `- …and ${hidden} more not shown. \`phax brief\` prints the phase's brief whole.`]
    : shown;
}

/**
 * The `## Brief for this phase` section of a phase's first prompt: the pushed
 * brief in compact form, as `push` chooses, or the line saying it is
 * unavailable and why, then the three instructions. No trailing newline.
 */
export function renderBriefSection(
  input:
    | { readonly kind: "answered"; readonly report: BriefReport }
    | { readonly kind: "failed"; readonly reason: string },
  push: BriefPush,
): string {
  const body =
    input.kind === "answered"
      ? answeredBody(input.report, push)
      : [
          `The brief is unavailable at phase start (${input.reason}). \`phax brief\` may still answer.`,
        ];
  return [HEADING, "", INTRO[push], "", ...body, "", ...INSTRUCTIONS].join("\n");
}

function wholeGuideLines(guide: ReportGuide | null): readonly string[] {
  return guide === null ? [] : [`    guide:  ${guide.summary} (read ${guide.read})`];
}

function wholeRuleLines(rule: BriefRule): readonly string[] {
  return [`  ${rule.rule}`, `    files:  ${rule.files.join(", ")}`, ...wholeGuideLines(rule.guide)];
}

const DUE_TEXT = { "this-phase": "   due this phase", later: "   due later" } as const;

function wholeFindingLines(finding: BriefFinding): readonly string[] {
  const due = finding.due === null ? "" : DUE_TEXT[finding.due];
  return [
    `  ${renderReportLocation(finding.location)}${due}`,
    `    rule:   ${finding.rule}`,
    `    found:  ${finding.message}`,
    ...finding.related.map(
      (related) => `    also involves ${renderReportLocation(related)} — ${related.why}`,
    ),
    ...wholeGuideLines(finding.guide),
  ];
}

/**
 * A brief report in whole form, as `phax brief` prints it: under `Rules`,
 * each rule with its files and guide; under `Findings`, each finding with its
 * location, due, rule, message, related locations and guide; both in the
 * provider's order. A list with nothing in it prints no heading. No trailing
 * newline.
 */
export function renderWholeBrief(report: BriefReport): string {
  return [
    ...(report.rules.length === 0 ? [] : ["Rules", ...report.rules.flatMap(wholeRuleLines)]),
    ...(report.findings.length === 0
      ? []
      : ["Findings", ...report.findings.flatMap(wholeFindingLines)]),
  ].join("\n");
}

/** Whether a brief report lists nothing: `phax brief` then prints `renderNoBrief`. */
export function isEmptyBrief(report: BriefReport): boolean {
  return report.rules.length === 0 && report.findings.length === 0;
}

/** What `phax brief` prints for an empty report; `null` is the phase's brief. */
export function renderNoBrief(files: readonly string[] | null): string {
  return files === null
    ? "No brief for this phase's planned files."
    : `No brief for ${files.join(", ")}.`;
}
