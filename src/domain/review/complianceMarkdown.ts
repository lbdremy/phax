/**
 * compliance-review.md, rendered from the accepted compliance answer alone.
 *
 * Layout, lines joined by a newline, the text ending in exactly one newline:
 *
 *   # Compliance review — <runId>
 *   (blank)
 *   Verdict: <verdict>
 *   (blank)
 *   <summary verbatim, or `None.` when empty or whitespace only>
 *
 * then, in this order, each block preceded by a blank line:
 *
 *   - one `## <phaseId> — <verdict>` section per perPhase entry, in the answer's
 *     order, a blank line, then one `- <dimension> · <severity> — <message>` line
 *     per finding, or `None.`;
 *   - `## Unplanned changes`, a blank line, then `- <phaseId> · <path> — <note>`
 *     lines, or `None.`;
 *   - `## Unmet promises`, a blank line, then `- <phaseId> · <promise> — <note>`
 *     lines, or `None.`;
 *   - `## Attention points`, a blank line, then `- <point>` lines, or `None.`;
 *   - `## Pointers`, a blank line, then `- <pointer>` lines, or `None.`.
 *
 * Text is inserted verbatim and never rewritten. The function is pure: no I/O,
 * no clock.
 */
export interface ComplianceReviewToRender {
  readonly verdict: string;
  readonly summary: string;
  readonly perPhase: readonly {
    readonly phaseId: string;
    readonly verdict: string;
    readonly findings: readonly {
      readonly dimension: string;
      readonly severity: string;
      readonly message: string;
    }[];
  }[];
  readonly unplannedChanges: readonly {
    readonly phaseId: string;
    readonly path: string;
    readonly note: string;
  }[];
  readonly unmetPromises: readonly {
    readonly phaseId: string;
    readonly promise: string;
    readonly note: string;
  }[];
  readonly attentionPoints: readonly string[];
  readonly pointers: readonly string[];
}

function section(title: string, items: readonly string[]): string[] {
  return ["", title, "", ...(items.length === 0 ? ["None."] : items)];
}

export function renderComplianceReviewMarkdown(
  runId: string,
  review: ComplianceReviewToRender,
): string {
  const lines = [
    `# Compliance review — ${runId}`,
    "",
    `Verdict: ${review.verdict}`,
    "",
    review.summary.trim() === "" ? "None." : review.summary,
  ];
  for (const phase of review.perPhase) {
    lines.push(
      ...section(
        `## ${phase.phaseId} — ${phase.verdict}`,
        phase.findings.map((f) => `- ${f.dimension} · ${f.severity} — ${f.message}`),
      ),
    );
  }
  lines.push(
    ...section(
      "## Unplanned changes",
      review.unplannedChanges.map((c) => `- ${c.phaseId} · ${c.path} — ${c.note}`),
    ),
    ...section(
      "## Unmet promises",
      review.unmetPromises.map((p) => `- ${p.phaseId} · ${p.promise} — ${p.note}`),
    ),
    ...section(
      "## Attention points",
      review.attentionPoints.map((p) => `- ${p}`),
    ),
    ...section(
      "## Pointers",
      review.pointers.map((p) => `- ${p}`),
    ),
  );
  return `${lines.join("\n")}\n`;
}
