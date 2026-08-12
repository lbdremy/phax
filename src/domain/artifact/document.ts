import { Either } from "effect";
import { ArtifactValidationError } from "../errors.js";
import { decodeArtifactFrontmatter, type FrontmatterProblem } from "./frontmatter.js";
import { type ArtifactKind, type ArtifactStatus, isTerminalStatus } from "./status.js";

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

// The allowed frontmatter key set per kind, rendered into schema-failure
// messages so an author sees exactly what a spec or plan block may contain.
const ALLOWED_KEYS: Record<ArtifactKind, string> = {
  spec: "status, date, audience, scope",
  plan: "status, source-spec, approved",
};

export function frontmatterProblemMessage(
  repoRelPath: string,
  kind: ArtifactKind,
  problem: FrontmatterProblem,
): string {
  switch (problem.kind) {
    case "missing-block":
      return `${repoRelPath} has no frontmatter block — lifecycle metadata must be YAML frontmatter (see docs/specs/26-artifact-frontmatter-metadata.md)`;
    case "yaml-syntax":
      return `${repoRelPath} has invalid YAML frontmatter: ${problem.detail}`;
    case "schema":
      return `${repoRelPath} has invalid frontmatter (allowed for a ${kind}: ${ALLOWED_KEYS[kind]}):\n${problem.detail}`;
  }
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

  const decoded = decodeArtifactFrontmatter(classification.kind, md);
  if (Either.isLeft(decoded)) {
    return Either.left(
      new ArtifactValidationError({
        path: repoRelPath,
        message: frontmatterProblemMessage(repoRelPath, classification.kind, decoded.left),
      }),
    );
  }
  const status = decoded.right.status;

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

  return Either.right({ kind: classification.kind, status });
}
