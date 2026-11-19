// The text of one fate comment on a pull request. Pure.
import { onOneLine } from "../reportText.js";
import { codeSpan, withoutMentions } from "../publish/markdownSafe.js";
import { findingLocation, type PrFinding } from "../publish/prFindings.js";

/**
 * The comment for a finding's latest fate record, or null for a finding that is open or
 * unrecorded, or whose latest history entry does not match its fate.
 */
export function renderFateComment(finding: PrFinding): string | null {
  const latest = finding.history.at(-1);
  if (latest === undefined || latest.fate !== finding.fate) return null;
  const second =
    latest.fate === "fixed"
      ? `Fixed by ${latest.commit.slice(0, 7)} (${latest.pathClasses.join(", ")})`
      : latest.fate === "dismissed"
        ? `Reason: ${withoutMentions(onOneLine(latest.verdict.why))}`
        : `Taken over by ${codeSpan(latest.to)}`;
  const first = `${finding.id} ${finding.fate} — ${findingLocation(finding)} — ${withoutMentions(onOneLine(finding.message))}`;
  return `${first}\n${second}`;
}
