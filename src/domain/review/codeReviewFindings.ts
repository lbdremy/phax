import type { CodeReviewFinding } from "../../schemas/codeReview.js";

const SEVERITY_ORDER = ["bug", "deviation", "concern", "info"] as const;

/** `2 findings (1 bug, 1 concern)`, `1 finding (1 info)` or `0 findings`. */
export function describeFindingCounts(
  findings: readonly Pick<CodeReviewFinding, "severity">[],
): string {
  const total = findings.length;
  const noun = total === 1 ? "finding" : "findings";
  if (total === 0) return `0 ${noun}`;
  const parts = SEVERITY_ORDER.flatMap((severity) => {
    const count = findings.filter((f) => f.severity === severity).length;
    return count === 0 ? [] : [`${count} ${severity}`];
  });
  return `${total} ${noun} (${parts.join(", ")})`;
}
