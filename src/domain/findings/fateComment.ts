// The text of one fate comment on a pull request. Pure.
import { onOneLine } from "../reportText.js";
import { codeSpan, withoutMentions } from "../publish/markdownSafe.js";
import { findingLocation, type PrFinding } from "../publish/prFindings.js";

/**
 * The comment for a finding's latest fate record, or null for a finding that is open or
 * unrecorded, or whose latest history entry does not match its fate. A fix names the commit
 * that carries it and the branch it was found on when its `landed` is found, else the recorded
 * commit alone, then its fate key, `<runId> <finding id>`, which stays true after a rewrite
 * (spec finding-fix-identity §5.12).
 */
export function renderFateComment(finding: PrFinding, runId: string): string | null {
  const latest = finding.history.at(-1);
  if (latest === undefined || latest.fate !== finding.fate) return null;
  const { landed } = finding;
  const fixedBy =
    landed !== null && landed.status === "found"
      ? `${landed.commit.slice(0, 7)} on ${withoutMentions(landed.branch)}`
      : null;
  const second =
    latest.fate === "fixed"
      ? `Fixed by ${fixedBy ?? latest.commit.slice(0, 7)} (${latest.pathClasses.join(", ")}) · ${withoutMentions(runId)} ${finding.id}`
      : latest.fate === "dismissed"
        ? `Reason: ${withoutMentions(onOneLine(latest.verdict.why))}`
        : `Taken over by ${codeSpan(latest.to)}`;
  const first = `${finding.id} ${finding.fate} — ${findingLocation(finding)} — ${withoutMentions(onOneLine(finding.message))}`;
  return `${first}\n${second}`;
}
