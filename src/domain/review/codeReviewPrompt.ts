export const CODE_REVIEW_PROMPT_FILENAME = "code-review-prompt.md";

export interface BuildCodeReviewPromptInput {
  readonly worktreePath: string;
  readonly reconciliationMd: string;
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
}

export function buildCodeReviewPrompt(input: BuildCodeReviewPromptInput): string {
  const { worktreePath, attentionPoints, compliance, complianceMissing } = input;

  const attentionPointsSection =
    attentionPoints.length === 0
      ? "_No attention points recorded._"
      : attentionPoints
          .map((p) => `- **${p.path}** — status: ${p.status}, phase: ${p.phaseRef}`)
          .join("\n");

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
    "1. Start by reading the files listed above and understanding what changed.",
    "2. Explain your findings to the developer before proposing fixes.",
    "3. Apply fixes only when the developer confirms.",
    "4. The developer will take over the session — hand off cleanly when asked.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
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

export function buildCodeReviewPositionalPrompt(promptFilePath: string): string {
  return `Read \`${promptFilePath}\` and begin the code review it describes. Do not start until you have read it.`;
}
