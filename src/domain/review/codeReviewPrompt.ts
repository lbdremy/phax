import {
  CODE_REVIEW_ESCAPES,
  CODE_REVIEW_LENSES,
  CODE_REVIEW_SEVERITIES,
} from "../../schemas/codeReview.js";
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

/** The headless review's answer under `.phax-context`, in the final worktree. */
export const CODE_REVIEW_ANSWER_FILENAME = "code-review.json";

/**
 * The prompt of the headless review: the interactive prompt's worklist,
 * compliance findings and doctrine, with no developer, no fix and an answer
 * file in place of the conversation.
 */
export function buildHeadlessCodeReviewPrompt(
  input: BuildCodeReviewPromptInput & { readonly answerPath: string },
): string {
  const { worktreePath, attentionPoints, compliance, complianceMissing, doctrine, answerPath } =
    input;

  const complianceSection = compliance
    ? buildComplianceSection(compliance)
    : complianceMissing
      ? "_No compliance findings are available for this run._\n"
      : "";

  return [
    "# Headless code review",
    "",
    "You review a phax run's change alone: no developer is present, you apply no fix, you edit no file,",
    "`git` is your only command, and you write only the answer file named below.",
    "",
    "## Worktree path (for code inspection)",
    "",
    worktreePath,
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
    '2. Ignore the doctrine\'s "In the session" section: nobody answers you.',
    "3. Write one finding per cause, most severe first.",
    "",
    ...doctrineLines(doctrine),
    "",
    "## Answer",
    "",
    `Write your answer to \`${answerPath}\` as JSON, in this exact shape, with every key required and no other key:`,
    "",
    "```json",
    '{ "version": 1, "findings": [ { "severity", "file", "line", "message", "lens", "escape", "criterion", "suggestion" } ] }',
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
    'When there is nothing to report, write `{"version":1,"findings":[]}`.',
  ].join("\n");
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
