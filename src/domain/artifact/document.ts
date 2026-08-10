import { Either } from "effect";
import { ArtifactValidationError } from "../errors.js";
import { readSourceSpecLine } from "./lineage.js";
import {
  type ArtifactKind,
  type ArtifactStatus,
  isTerminalStatus,
  parsePlanStatus,
  parseSpecStatus,
  PLAN_STATUSES,
  SPEC_STATUSES,
} from "./status.js";

export interface ArtifactClassification {
  readonly kind: ArtifactKind;
  readonly inArchive: boolean;
}

const SPEC_ARCHIVE_DIR = "docs/specs/archive/";
const SPEC_DIR = "docs/specs/";
const PLAN_ARCHIVE_DIR = "docs/plans/archive/";
const PLAN_DIR = "docs/plans/";

export function classifyArtifactPath(repoRelPath: string): ArtifactClassification | null {
  if (repoRelPath.startsWith(SPEC_ARCHIVE_DIR)) return { kind: "spec", inArchive: true };
  if (repoRelPath.startsWith(SPEC_DIR)) return { kind: "spec", inArchive: false };
  if (repoRelPath.startsWith(PLAN_ARCHIVE_DIR)) return { kind: "plan", inArchive: true };
  if (repoRelPath.startsWith(PLAN_DIR)) return { kind: "plan", inArchive: false };
  return null;
}

export function archivePathFor(repoRelPath: string): string {
  const classification = classifyArtifactPath(repoRelPath);
  if (classification === null) {
    throw new Error(`archivePathFor: ${repoRelPath} is not a recognized artifact path`);
  }
  const dir = classification.kind === "spec" ? SPEC_DIR : PLAN_DIR;
  const archiveDir = classification.kind === "spec" ? SPEC_ARCHIVE_DIR : PLAN_ARCHIVE_DIR;
  if (classification.inArchive) return repoRelPath;
  const fileName = repoRelPath.slice(dir.length);
  return `${archiveDir}${fileName}`;
}

const STATUS_LINE_PATTERN = /^Status:\s*(.+?)\s*$/;
const H2_PATTERN = /^##\s/;

function headerLines(md: string): string[] {
  const lines = md.split("\n");
  const h2Index = lines.findIndex((line) => H2_PATTERN.test(line));
  return h2Index === -1 ? lines : lines.slice(0, h2Index);
}

export function readStatusLine(md: string): string | null {
  for (const line of headerLines(md)) {
    const match = STATUS_LINE_PATTERN.exec(line);
    if (match) return match[1] as string;
  }
  return null;
}

export function replaceStatusLine(md: string, next: string): string {
  const lines = md.split("\n");
  const h2Index = lines.findIndex((line) => H2_PATTERN.test(line));
  const searchLimit = h2Index === -1 ? lines.length : h2Index;
  for (let i = 0; i < searchLimit; i++) {
    if (STATUS_LINE_PATTERN.test(lines[i] as string)) {
      lines[i] = `Status: ${next}`;
      return lines.join("\n");
    }
  }
  return md;
}

export function validateArtifact(
  repoRelPath: string,
  md: string,
): Either.Either<{ kind: ArtifactKind; status: ArtifactStatus }, ArtifactValidationError> {
  const classification = classifyArtifactPath(repoRelPath);
  if (classification === null) {
    return Either.left(
      new ArtifactValidationError({
        path: repoRelPath,
        message: `${repoRelPath} is not a recognized artifact path (expected docs/specs/, docs/specs/archive/, docs/plans/, or docs/plans/archive/)`,
      }),
    );
  }

  const rawStatus = readStatusLine(md);
  if (rawStatus === null) {
    return Either.left(
      new ArtifactValidationError({
        path: repoRelPath,
        message: `${repoRelPath} has no "Status:" line in its header`,
      }),
    );
  }

  const allowed = classification.kind === "spec" ? SPEC_STATUSES : PLAN_STATUSES;
  const status =
    classification.kind === "spec" ? parseSpecStatus(rawStatus) : parsePlanStatus(rawStatus);
  if (status === null) {
    return Either.left(
      new ArtifactValidationError({
        path: repoRelPath,
        message: `${repoRelPath} has status "${rawStatus}", which is not valid for a ${classification.kind} (allowed: ${allowed.join(", ")})`,
      }),
    );
  }

  const terminal = isTerminalStatus(status);
  if (terminal && !classification.inArchive) {
    return Either.left(
      new ArtifactValidationError({
        path: repoRelPath,
        message: `${repoRelPath} has terminal status "${status}" but is not inside an archive/ directory`,
      }),
    );
  }
  if (!terminal && classification.inArchive) {
    return Either.left(
      new ArtifactValidationError({
        path: repoRelPath,
        message: `${repoRelPath} has non-terminal status "${status}" but is inside an archive/ directory`,
      }),
    );
  }

  if (classification.kind === "plan" && readSourceSpecLine(md) === null) {
    return Either.left(
      new ArtifactValidationError({
        path: repoRelPath,
        message: `${repoRelPath} has no "Source-Spec:" declaration in its header (use "Source-Spec: <path>" or "Source-Spec: (none)")`,
      }),
    );
  }

  return Either.right({ kind: classification.kind, status });
}
