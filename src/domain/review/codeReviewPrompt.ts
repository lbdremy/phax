import { answerJsonSchema } from "../../schemas/answerSchemas.js";
import {
  CODE_REVIEW_ESCAPES,
  CODE_REVIEW_LENSES,
  CODE_REVIEW_SEVERITIES,
} from "../../schemas/codeReview.js";
import { CURRENT_STAMPS } from "../../schemas/release.js";
import { schemaUrl } from "../../schemas/schemaUrl.js";
import { PHAX_REVIEW_SKILL } from "../skills/catalog.js";

export const CODE_REVIEW_PROMPT_FILENAME = "code-review-prompt.md";

/** The review doctrine the session follows: the project's copy of the skill, or the bundled one. */
export interface CodeReviewDoctrine {
  readonly source: "bundled" | "project";
  readonly text: string;
}

export interface BuildCodeReviewPromptInput {
  readonly worktreePath: string;
  readonly attentionPoints: ReadonlyArray<{
    readonly path: string;
    readonly status: string;
    readonly phaseRef: string;
  }>;
  readonly compliance?: {
    readonly attentionPoints: readonly string[];
    readonly pointers: readonly string[];
    readonly deviationFindings: ReadonlyArray<{
      readonly phaseId: string;
      readonly dimension: string;
      readonly severity: string;
      readonly message: string;
    }>;
  };
  readonly complianceMissing: boolean;
  readonly doctrine: CodeReviewDoctrine;
}

export function buildCodeReviewPrompt(input: BuildCodeReviewPromptInput): string {
  const { worktreePath, attentionPoints, compliance, complianceMissing, doctrine } = input;

  const attentionPointsSection = buildAttentionPointsSection(attentionPoints);

  const complianceSection = compliance ? buildComplianceSection(compliance) : "";

  const complianceMissingNote = complianceMissing
    ? "\n> **Tip:** Run `phax review-compliance <short-name>` first to generate compliance findings and seed this session with richer context.\n"
    : "";

  return [
    "# Code review session",
    "",
    "You are assisting a developer in an **interactive code review** of a phax run.",
    "This is NOT a gate and NOT a one-shot report.",
    "Your role is to investigate, explain findings, and propose or apply fixes — but only with the developer in the loop.",
    "Do not make sweeping changes without confirmation.",
    "",
    "## Worktree path (for code inspection)",
    "",
    worktreePath,
    "",
    "## Primary worklist — attention points from reconciliation",
    "",
    "These files were flagged during the run and require review:",
    "",
    attentionPointsSection,
    complianceMissingNote,
    complianceSection,
    "## How to proceed",
    "",
    "1. Follow the review doctrine below: use the change before you read its code, then work outside-in.",
    "2. Report what you saw using it first, then your findings, most severe first, each with its severity, lens, escape and suggestion.",
    "3. Apply fixes only when the developer confirms.",
    "4. The developer will take over the session — hand off cleanly when asked.",
    "",
    ...doctrineLines(doctrine),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/** What the headless prompt adds to the interactive worklist and doctrine. */
export interface HeadlessCodeReviewPromptInput extends BuildCodeReviewPromptInput {
  /** The commit the run started from, or null when no phase noted one. */
  readonly baseRef: string | null;
  /** The run's branch, holding every phase's commits. */
  readonly runBranch: string;
  /** The git commands the session may run, read only. */
  readonly gitCommands: readonly string[];
}

/**
 * The prompt of the headless review: the interactive prompt's worklist,
 * compliance findings and doctrine, read only, with the answer as the
 * session's final message. The restrictions are this pass's: a person may
 * resume the session afterwards and ask it for fixes.
 */
export function buildHeadlessCodeReviewPrompt(input: HeadlessCodeReviewPromptInput): string {
  const { worktreePath, attentionPoints, compliance, complianceMissing, doctrine } = input;

  const complianceSection =
    compliance && hasComplianceFindings(compliance)
      ? buildComplianceSection(compliance)
      : complianceMissing
        ? "_No compliance findings are available for this run._\n"
        : "";

  return [
    "# Headless code review",
    "",
    "In this pass you review a phax run's change alone: nobody answers you, you apply no fix and you",
    `edit no file. You can read files, and run only these read-only git commands: ${idList(input.gitCommands)}.`,
    "A developer may later resume this session to ask you for fixes; from then on, follow their",
    "instructions.",
    "",
    "## Worktree path (for code inspection)",
    "",
    worktreePath,
    "",
    "## The change",
    "",
    input.baseRef === null
      ? `The run's branch is \`${input.runBranch}\`; no base commit was noted.`
      : `The run's branch is \`${input.runBranch}\`, started from \`${input.baseRef}\`: \`git diff ${input.baseRef}..HEAD\` is the whole change.`,
    "",
    "## Primary worklist — attention points from reconciliation",
    "",
    "These files were flagged during the run and require review:",
    "",
    buildAttentionPointsSection(attentionPoints),
    "",
    complianceSection,
    "## How to proceed",
    "",
    "1. Follow the review doctrine below outside-in, but read its \"use it before you read it\" step as a read of the surface: the commands' help text, the README and docs, the spec's before and after examples, and the tests. You cannot run the change.",
    "2. The doctrine's steps that need `phax records explain --gates` or the run folder's fix-attempt transcripts are not available in this pass: judge a `weakened` escape from the tests' history in git alone, and say so in the finding.",
    '3. Ignore the doctrine\'s "In the session" section in this pass: nobody answers you.',
    "4. Write one finding per cause, most severe first.",
    "",
    ...doctrineLines(doctrine),
    "",
    "## Answer",
    "",
    "Your final message is your answer: JSON alone, valid against this JSON Schema, with every key required and no other key:",
    "",
    "```json",
    JSON.stringify(answerJsonSchema("code-review"), null, 2),
    "```",
    "",
    `- \`severity\`: one of ${idList(CODE_REVIEW_SEVERITIES)}.`,
    `- \`lens\`: one of ${idList(CODE_REVIEW_LENSES)}.`,
    `- \`escape\`: one of ${idList(CODE_REVIEW_ESCAPES)}.`,
    "- `file`: a path relative to the worktree.",
    "- `line`: a positive integer, 1 for a whole-file finding.",
    "- `criterion`: an acceptance-criterion id of the source spec, or null.",
    "- `message` and `suggestion`: non-empty.",
    "",
    `When there is nothing to report, answer \`${JSON.stringify({ $schema: schemaUrl("code-review", CURRENT_STAMPS["code-review"]), findings: [] })}\`.`,
  ].join("\n");
}

function hasComplianceFindings(compliance: BuildCodeReviewPromptInput["compliance"] & {}): boolean {
  return (
    compliance.attentionPoints.length > 0 ||
    compliance.pointers.length > 0 ||
    compliance.deviationFindings.length > 0
  );
}

function idList(ids: readonly string[]): string {
  return ids.map((id) => `\`${id}\``).join(", ");
}

function buildAttentionPointsSection(
  attentionPoints: BuildCodeReviewPromptInput["attentionPoints"],
): string {
  return attentionPoints.length === 0
    ? "_No attention points recorded._"
    : attentionPoints
        .map((p) => `- **${p.path}** — status: ${p.status}, phase: ${p.phaseRef}`)
        .join("\n");
}

function doctrineLines(doctrine: CodeReviewDoctrine): string[] {
  return [
    `## Review doctrine — \`${PHAX_REVIEW_SKILL}\` (${doctrine.source})`,
    "",
    skillBody(doctrine.text),
  ];
}

function buildComplianceSection(compliance: BuildCodeReviewPromptInput["compliance"] & {}): string {
  const lines: string[] = ["## Compliance findings (from review-compliance)", ""];

  if (compliance.attentionPoints.length > 0) {
    lines.push("### Attention points");
    lines.push("");
    for (const ap of compliance.attentionPoints) {
      lines.push(`- ${ap}`);
    }
    lines.push("");
  }

  if (compliance.pointers.length > 0) {
    lines.push("### Pointers (possible issues to confirm via code review)");
    lines.push("");
    for (const pointer of compliance.pointers) {
      lines.push(`- ${pointer}`);
    }
    lines.push("");
  }

  if (compliance.deviationFindings.length > 0) {
    lines.push("### Per-phase deviation findings");
    lines.push("");
    for (const finding of compliance.deviationFindings) {
      lines.push(
        `- **${finding.phaseId}** [${finding.dimension}] (${finding.severity}): ${finding.message}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// A skill's text without its YAML frontmatter.
function skillBody(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export function buildCodeReviewPositionalPrompt(promptFilePath: string): string {
  return `Read \`${promptFilePath}\` and begin the code review it describes. Do not start until you have read it.`;
}
