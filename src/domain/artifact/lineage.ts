const SOURCE_SPEC_LINE_PATTERN = /^Source-Spec:\s*(.*?)\s*$/;
const STATUS_LINE_PATTERN = /^Status:\s*(.+?)\s*$/;
const APPROVED_LINE_PATTERN = /^Approved:\s*(.+?)\s*$/;
const H2_PATTERN = /^##\s/;

function headerLines(md: string): string[] {
  const lines = md.split("\n");
  const h2Index = lines.findIndex((line) => H2_PATTERN.test(line));
  return h2Index === -1 ? lines : lines.slice(0, h2Index);
}

export type SourceSpecDeclaration =
  | { readonly kind: "spec"; readonly path: string }
  | { readonly kind: "none" };

export function readSourceSpecLine(md: string): SourceSpecDeclaration | null {
  for (const line of headerLines(md)) {
    const match = SOURCE_SPEC_LINE_PATTERN.exec(line);
    if (match === null) continue;
    const value = match[1] as string;
    if (value.length === 0) return null;
    if (value === "(none)") return { kind: "none" };
    return { kind: "spec", path: value };
  }
  return null;
}

export function fingerprintableContent(md: string): string {
  const lines = md.split("\n");
  const h2Index = lines.findIndex((line) => H2_PATTERN.test(line));
  const searchLimit = h2Index === -1 ? lines.length : h2Index;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (i < searchLimit && (STATUS_LINE_PATTERN.test(line) || APPROVED_LINE_PATTERN.test(line))) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

export function upsertApprovedLine(md: string, dateIso: string, shortBaseline: string): string {
  const date = (dateIso.split("T")[0] as string) ?? dateIso;
  const stampLine = `Approved: ${date} @ ${shortBaseline}`;

  const lines = md.split("\n");
  const h2Index = lines.findIndex((line) => H2_PATTERN.test(line));
  const searchLimit = h2Index === -1 ? lines.length : h2Index;

  for (let i = 0; i < searchLimit; i++) {
    if (APPROVED_LINE_PATTERN.test(lines[i] as string)) {
      lines[i] = stampLine;
      return lines.join("\n");
    }
  }

  let sourceSpecIndex = -1;
  let statusIndex = -1;
  for (let i = 0; i < searchLimit; i++) {
    const line = lines[i] as string;
    if (SOURCE_SPEC_LINE_PATTERN.test(line)) sourceSpecIndex = i;
    if (STATUS_LINE_PATTERN.test(line)) statusIndex = i;
  }

  const insertAfter = sourceSpecIndex !== -1 ? sourceSpecIndex : statusIndex;
  if (insertAfter === -1) {
    return [stampLine, ...lines].join("\n");
  }
  lines.splice(insertAfter + 1, 0, stampLine);
  return lines.join("\n");
}

export const STALENESS_REASONS = ["spec-changed", "ground-changed", "self-changed"] as const;
export type StalenessReason = (typeof STALENESS_REASONS)[number];

export type StalenessEvidence =
  | { readonly reason: "spec-changed"; readonly specPath: string }
  | {
      readonly reason: "ground-changed";
      readonly baseline: string;
      readonly files: readonly string[];
    }
  | { readonly reason: "self-changed" };

export type PlanStalenessVerdict =
  | { readonly kind: "fresh" }
  | { readonly kind: "stale"; readonly evidence: readonly StalenessEvidence[] }
  | { readonly kind: "missing-record"; readonly detail: string };

export interface ApprovalRecordLike {
  readonly planFingerprint: string;
  readonly approvedAt: string;
  readonly baseline: string;
  readonly sourceSpec: { readonly path: string; readonly fingerprint: string } | null;
}

export interface ComputeStalenessInput {
  readonly record: ApprovalRecordLike | null;
  readonly baselineExists: boolean;
  readonly currentPlanFingerprint: string;
  readonly currentSpecFingerprint: string | null;
  readonly changedFilesSinceBaseline: readonly string[];
  readonly footprint: readonly string[];
}

export function computeStaleness(input: ComputeStalenessInput): PlanStalenessVerdict {
  const { record } = input;
  if (record === null) {
    return { kind: "missing-record", detail: "no approval record exists for this plan" };
  }
  if (!input.baselineExists) {
    return {
      kind: "missing-record",
      detail: `the recorded approval baseline ${record.baseline} no longer exists`,
    };
  }

  const evidence: StalenessEvidence[] = [];

  if (
    record.sourceSpec !== null &&
    input.currentSpecFingerprint !== null &&
    record.sourceSpec.fingerprint !== input.currentSpecFingerprint
  ) {
    evidence.push({ reason: "spec-changed", specPath: record.sourceSpec.path });
  }

  const footprintSet = new Set(input.footprint);
  const groundChanged = input.changedFilesSinceBaseline.filter((file) => footprintSet.has(file));
  if (groundChanged.length > 0) {
    evidence.push({ reason: "ground-changed", baseline: record.baseline, files: groundChanged });
  }

  if (record.planFingerprint !== input.currentPlanFingerprint) {
    evidence.push({ reason: "self-changed" });
  }

  if (evidence.length === 0) return { kind: "fresh" };
  return { kind: "stale", evidence };
}

export const APPROVALS_FILE_PATH = "docs/plans/approvals.json";
