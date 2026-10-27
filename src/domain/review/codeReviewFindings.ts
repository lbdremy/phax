import type { CodeReviewFinding } from "../../schemas/codeReview.js";
import type { ProviderId } from "../routing/types.js";
import { getSessionAdapter } from "../session/index.js";

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

/**
 * How the person fixes a review's findings: `phax review-code <run>` when the
 * recorded session's provider resumes through phax, else that provider's own
 * manual resume, naming the session. None when there is nothing to fix.
 */
export function codeReviewFixHint(
  findingCount: number,
  session: {
    readonly provider: ProviderId;
    readonly sessionId: string;
    readonly worktreePath: string;
  },
  runRef: string,
): string | undefined {
  if (findingCount === 0) return undefined;
  const invocation = getSessionAdapter(session.provider).buildPrePromptedInvocation({
    cwd: session.worktreePath,
    sessionId: session.sessionId,
    initialPrompt: null,
  });
  return "unsupported" in invocation
    ? `Fix them in the session — ${invocation.unsupported}`
    : `Fix them in the session: phax review-code ${runRef}`;
}
