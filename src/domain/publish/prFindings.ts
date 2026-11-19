// The `## Review findings` section of a pull request description. Pure.
import type {
  CodeReviewFindingEntry,
  ComplianceFindingEntry,
  FindingListRecords,
} from "../../schemas/findingList.js";
import { onOneLine } from "../reportText.js";
import { codeSpan, withoutMentions } from "./markdownSafe.js";

export type PrFinding = CodeReviewFindingEntry | ComplianceFindingEntry;

/** The findings as `listRunFindings` reads them, or why they could not be read. */
export type PrFindings =
  | { kind: "read"; records: FindingListRecords; findings: readonly PrFinding[] }
  | { kind: "unreadable"; reason: string };

/** Where a finding is: a code span of `<file>:<line>`, or the plain `<phaseId> <dimension>`. */
export function findingLocation(finding: PrFinding): string {
  return finding.source === "code-review"
    ? codeSpan(onOneLine(`${finding.file}:${finding.line}`))
    : `${finding.phaseId} ${finding.dimension}`;
}

export function splitPrFindings(findings: readonly PrFinding[]): {
  open: PrFinding[];
  deferred: PrFinding[];
  fixed: number;
  dismissed: number;
  unrecorded: number;
} {
  return {
    open: findings.filter((f) => f.fate === "open"),
    deferred: findings.filter((f) => f.fate === "deferred"),
    fixed: findings.filter((f) => f.fate === "fixed").length,
    dismissed: findings.filter((f) => f.fate === "dismissed").length,
    unrecorded: findings.filter((f) => f.fate === "unrecorded").length,
  };
}

function findingLine(finding: PrFinding): string {
  const base = `- ${finding.id} ${finding.severity} — ${findingLocation(finding)} — ${withoutMentions(onOneLine(finding.message))}`;
  if (finding.fate !== "deferred") return base;
  const latest = finding.history.at(-1);
  return latest?.fate === "deferred" ? `${base} → ${codeSpan(latest.to)}` : base;
}

function block(
  title: string,
  noun: string,
  findings: readonly PrFinding[],
  kept: number,
): string | null {
  if (findings.length === 0) return null;
  const lines = findings.slice(0, kept).map(findingLine);
  const cut = findings.length - lines.length;
  if (cut > 0) lines.push(`- …and ${cut} more ${noun}${cut === 1 ? "" : "s"}`);
  return [`${title} (${findings.length})`, ...lines].join("\n");
}

/** The section, with the first `keep.open` open and `keep.deferred` deferred findings listed. */
export function renderPrFindingsSection(
  input: PrFindings,
  keep: { open: number; deferred: number },
  shortName: string,
): string {
  const heading = "## Review findings";
  if (input.kind === "unreadable") {
    const reason = withoutMentions(onOneLine(input.reason));
    return `${heading}\n\nThe findings could not be read (${reason}): \`phax finding list ${shortName}\` names the cause.`;
  }
  if (input.findings.length === 0) return `${heading}\n\nNo findings.`;
  const split = splitPrFindings(input.findings);
  const countLine =
    `Fixed: ${split.fixed} · Dismissed: ${split.dismissed}` +
    (split.unrecorded > 0 ? ` · Unrecorded: ${split.unrecorded}` : "");
  const parts = [
    ...(input.records === "unavailable"
      ? [
          `The fates could not be read from phax/records/v1, so every finding shows as open: \`phax finding list ${shortName}\` reads them again.`,
        ]
      : []),
    block("Open", "open finding", split.open, keep.open),
    block("Deferred", "deferred finding", split.deferred, keep.deferred),
    countLine,
  ].filter((p): p is string => p !== null);
  return [heading, ...parts].join("\n\n");
}
