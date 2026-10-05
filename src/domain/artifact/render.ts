import {
  OLD_PLAN_LEDGER_PATH,
  OLD_SPEC_LEDGER_PATH,
  type ApprovalMigrationResult,
  type OrphanApprovalRecord,
} from "./approvalRecordFile.js";
import type { PlanStalenessVerdict, StalenessEvidence } from "./lineage.js";

export interface StalenessReportEntry {
  readonly path: string;
  readonly result: PlanStalenessVerdict | { readonly kind: "error"; readonly message: string };
}

export type StalenessReport = readonly StalenessReportEntry[];

export interface StalenessFlip {
  readonly path: string;
  readonly verdict: PlanStalenessVerdict;
}

function renderEvidenceLine(e: StalenessEvidence): string {
  if (e.reason === "spec-changed") return `  spec-changed: ${e.specPath} changed since approval`;
  if (e.reason === "ground-changed") {
    return `  ground-changed: ${e.files.join(", ")} changed since baseline ${e.baseline}`;
  }
  return `  self-changed: the plan itself changed since approval`;
}

function renderVerdictLines(path: string, verdict: PlanStalenessVerdict): string[] {
  if (verdict.kind === "fresh") return [];
  if (verdict.kind === "missing-record") {
    return [
      `  missing-record: ${verdict.detail} — re-approve with "phax artifact approve ${path}"`,
    ];
  }
  return verdict.evidence.map(renderEvidenceLine);
}

export function renderStalenessReport(report: StalenessReport): string {
  const lines: string[] = [];
  lines.push("=== Plan Staleness Report ===");
  lines.push("");

  if (report.length === 0) {
    lines.push("No Approved plans found.");
    return lines.join("\n");
  }

  for (const entry of report) {
    if (entry.result.kind === "error") {
      lines.push(`${entry.path}: ERROR — ${entry.result.message}`);
      continue;
    }
    if (entry.result.kind === "fresh") {
      lines.push(`${entry.path}: fresh`);
      continue;
    }
    lines.push(`${entry.path}: STALE`);
    for (const line of renderVerdictLines(entry.path, entry.result)) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}

export function renderOrphanRecordWarning(orphan: OrphanApprovalRecord): string {
  return `warning: orphan approval record ${orphan.recordFile} — ${orphan.artifact} does not exist; delete the record file`;
}

function recordFileCount(n: number): string {
  return `${n} record file${n === 1 ? "" : "s"}`;
}

/**
 * The stdout lines of `phax artifact migrate-approvals`. Orphans are not part
 * of it: each is a `renderOrphanRecordWarning` line on stderr.
 */
export function renderMigrationReport(result: ApprovalMigrationResult): readonly string[] {
  if (result.kind === "nothing-to-migrate") {
    return [`nothing to migrate: no ${OLD_PLAN_LEDGER_PATH} or ${OLD_SPEC_LEDGER_PATH}`];
  }
  const lines: string[] = [];
  for (const ledger of result.ledgers) {
    lines.push(`${ledger.ledgerPath} → ${recordFileCount(ledger.recordFiles.length)}`);
    for (const recordFile of ledger.recordFiles) lines.push(`  ${recordFile}`);
  }
  lines.push(`committed ${result.commit.hash.slice(0, 7)} ${result.commit.subject}`);
  return lines;
}

export function renderStalenessApply(flipped: readonly StalenessFlip[]): string {
  const lines: string[] = [];
  lines.push("=== Plan Staleness Apply ===");
  lines.push("");

  if (flipped.length === 0) {
    lines.push("No plans flipped.");
    return lines.join("\n");
  }

  for (const flip of flipped) {
    lines.push(`${flip.path}: Approved -> Stale`);
    for (const line of renderVerdictLines(flip.path, flip.verdict)) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}
