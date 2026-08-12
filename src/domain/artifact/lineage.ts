import { Either } from "effect";
import {
  decodeArtifactFrontmatter,
  setFrontmatterKeys,
  type FrontmatterProblem,
} from "./frontmatter.js";

export type SourceSpecDeclaration =
  | { readonly kind: "spec"; readonly path: string }
  | { readonly kind: "none" };

// Reads a plan's `source-spec` frontmatter key. Callers invoke this only after
// validateArtifact has accepted the plan, so a decode failure (which validation
// would already have rejected) is reported as "no declaration".
export function readSourceSpec(md: string): SourceSpecDeclaration | null {
  const decoded = decodeArtifactFrontmatter("plan", md);
  if (Either.isLeft(decoded)) return null;
  const value = (decoded.right as { readonly "source-spec": string | null })["source-spec"];
  if (value === null) return { kind: "none" };
  return { kind: "spec", path: value };
}

// Upserts the `approved` frontmatter mapping (date + short baseline), replacing
// any previous value in place and leaving every other key and the body
// byte-identical. Fails with a FrontmatterProblem when the block is absent or
// unparseable — the app layer lifts that into ArtifactValidationError.
export function stampApproved(
  md: string,
  dateIso: string,
  shortBaseline: string,
): Either.Either<string, FrontmatterProblem> {
  const date = (dateIso.split("T")[0] as string) ?? dateIso;
  return setFrontmatterKeys(md, [{ key: "approved", value: { date, baseline: shortBaseline } }]);
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
