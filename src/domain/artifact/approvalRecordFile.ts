import type { ArtifactKind } from "./status.js";

// Each approval record lives in its own file, named after its artifact:
// docs/plans/<plan>.md → docs/plans/approvals/<plan>.json, and the same for
// specs. Every record path is derived here and nowhere else.

export const PLAN_APPROVAL_RECORD_DIR = "docs/plans/approvals/";
export const SPEC_APPROVAL_RECORD_DIR = "docs/specs/approvals/";

// The shared ledgers an older phax wrote. While either exists, every command
// that reads or writes records refuses until `phax artifact migrate-approvals`
// splits it; nothing else reads them.
export const OLD_PLAN_LEDGER_PATH = "docs/plans/approvals.json";
export const OLD_SPEC_LEDGER_PATH = "docs/specs/approvals.json";

const LIVE_DIR: Record<ArtifactKind, string> = { plan: "docs/plans/", spec: "docs/specs/" };

const RECORD_DIR: Record<ArtifactKind, string> = {
  plan: PLAN_APPROVAL_RECORD_DIR,
  spec: SPEC_APPROVAL_RECORD_DIR,
};

// The file name of `path` when it sits directly in `dir` and ends in `ext`,
// with something before the extension; null otherwise.
function stemIn(dir: string, ext: string, path: string): string | null {
  if (!path.startsWith(dir)) return null;
  const fileName = path.slice(dir.length);
  if (fileName.includes("/") || !fileName.endsWith(ext)) return null;
  const stem = fileName.slice(0, -ext.length);
  return stem.length > 0 ? stem : null;
}

/** A live artifact sits directly under docs/plans/ or docs/specs/ and ends in `.md`. */
export function isLiveArtifactPath(kind: ArtifactKind, path: string): boolean {
  return stemIn(LIVE_DIR[kind], ".md", path) !== null;
}

/**
 * The record file of a live artifact. Null for anything else — an archived,
 * nested or record path never carries a record, so no lookup touches disk.
 */
export function approvalRecordPathFor(kind: ArtifactKind, artifactPath: string): string | null {
  const stem = stemIn(LIVE_DIR[kind], ".md", artifactPath);
  return stem === null ? null : `${RECORD_DIR[kind]}${stem}.json`;
}

/** The inverse of approvalRecordPathFor: the artifact a record file is named after. */
export function artifactPathForRecordFile(
  recordPath: string,
): { readonly kind: ArtifactKind; readonly artifact: string } | null {
  for (const kind of ["plan", "spec"] as const) {
    const stem = stemIn(RECORD_DIR[kind], ".json", recordPath);
    if (stem !== null) return { kind, artifact: `${LIVE_DIR[kind]}${stem}.md` };
  }
  return null;
}

/** The approvals directory holding every record file of `kind`, with its trailing slash. */
export function approvalRecordDirFor(kind: ArtifactKind): string {
  return RECORD_DIR[kind];
}

/** A record file whose artifact does not exist: reported, never failed on or deleted. */
export interface OrphanApprovalRecord {
  readonly recordFile: string;
  readonly artifact: string;
}

/** Any path under an approvals/ directory belongs to the record files, never to an artifact. */
export function isApprovalRecordPath(path: string): boolean {
  return path.startsWith(PLAN_APPROVAL_RECORD_DIR) || path.startsWith(SPEC_APPROVAL_RECORD_DIR);
}
