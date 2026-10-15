import {
  OLD_PLAN_LEDGER_PATH,
  OLD_SPEC_LEDGER_PATH,
  type ApprovalMigrationResult,
  type OrphanApprovalRecord,
} from "./approvalRecordFile.js";
import type {
  DocumentMigrationRefusal,
  DocumentMigrationResult,
  MigratedArtifact,
} from "./documentMigration.js";
import type { PlanStalenessVerdict, StalenessEvidence } from "./lineage.js";
import type { QuestionSummary } from "./questions.js";
import { describeStampedShape } from "./sidecar.js";

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

/** `open <k> (<ids>) · arbitrated <m> (<l> lifted)`; the ids are left out when none is open. */
export function renderQuestionCounts(summary: QuestionSummary): string {
  const openIds = summary.open.length === 0 ? "" : ` (${summary.open.join(", ")})`;
  return (
    `open ${String(summary.open.length)}${openIds}` +
    ` · arbitrated ${String(summary.arbitrated)} (${String(summary.lifted)} lifted)`
  );
}

function migratedArtifactLines(artifact: MigratedArtifact, width: number): string[] {
  const state = artifact.bodyChanged ? renderQuestionCounts(artifact.questions) : "body unchanged";
  const lines = [`  ${artifact.path.padEnd(width)}  ${artifact.status.padEnd(8)}  ${state}`];
  if (!artifact.editedSinceApproval) return lines;
  const { open } = artifact.questions;
  lines.push(
    open.length === 0
      ? `    now edited since approval — re-approve with \`phax artifact approve ${artifact.path}\``
      : `    now edited since approval, with open questions ${open.join(", ")} — reopen it with \`phax artifact reopen ${artifact.path}\` before re-approving`,
  );
  return lines;
}

/**
 * The stdout lines of `phax artifact migrate-documents`: one group per format
 * and older shape, each artifact with its status and question counts (or
 * `body unchanged`), the Approved artifacts it leaves edited since approval,
 * the plans it leaves stale, and the commit.
 */
export function renderDocumentMigrationReport(result: DocumentMigrationResult): readonly string[] {
  if (result.kind === "nothing-to-migrate") {
    return ["nothing to migrate: every live spec and plan sidecar is at its current shape"];
  }
  const width = Math.max(
    ...result.groups.flatMap((g) => g.artifacts.map((a) => a.path.length)),
    ...result.stalePlans.map((p) => p.path.length),
  );
  const lines: string[] = [];
  for (const group of result.groups) {
    lines.push(`${describeStampedShape(group.format, group.fromShape)} → ${group.toShape}`);
    for (const artifact of group.artifacts) lines.push(...migratedArtifactLines(artifact, width));
  }
  if (result.stalePlans.length > 0) {
    lines.push("stale (spec-changed)");
    for (const plan of result.stalePlans) {
      lines.push(`  ${plan.path.padEnd(width)}  its spec ${plan.specPath} was re-rendered`);
    }
  }
  lines.push(`committed ${result.commit.hash.slice(0, 7)} ${result.commit.subject}`);
  return lines;
}

/** The refusal of `phax artifact migrate-documents`: each refused artifact, its problem and its remedy. */
export function renderDocumentMigrationRefusal(
  refusals: readonly DocumentMigrationRefusal[],
): string {
  return refusals
    .flatMap((r) => [`migrate refused: ${r.path} ${r.problem}`, `  ${r.remedy}`])
    .join("\n");
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
