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

export function renderComplianceReviewMarkdown(
  _runId: string,
  _review: ComplianceReviewToRender,
): string {
  throw new Error("complianceMarkdown: not implemented");
}
