import { Either } from "effect";
import type { PlanFrontmatter } from "../../schemas/artifactFrontmatter.js";
import { approvalRecordPathFor } from "./approvalRecordFile.js";
import {
  decodeArtifactFrontmatter,
  removeFrontmatterKeys,
  setFrontmatterKeys,
  type FrontmatterProblem,
} from "./frontmatter.js";

export type SourceSpecDeclaration =
  | { readonly kind: "spec"; readonly path: string; readonly completesSpec: boolean }
  | { readonly kind: "none" };

// Reads a plan's `source-spec` and `completes-spec` frontmatter keys. Callers
// invoke this only after validateArtifact has accepted the plan, so a decode
// failure (which validation would already have rejected) is reported as "no
// declaration".
export function readSourceSpec(md: string): SourceSpecDeclaration | null {
  const decoded = decodeArtifactFrontmatter("plan", md);
  if (Either.isLeft(decoded)) return null;
  const frontmatter = decoded.right;
  if (frontmatter["source-spec"] === null) return { kind: "none" };
  return {
    kind: "spec",
    path: frontmatter["source-spec"],
    completesSpec: frontmatter["completes-spec"],
  };
}

/**
 * A plan's frontmatter as lint and the overview read it: decoded, absent, or a
 * block that does not decode. A block that does not decode is never read in
 * part: neither its status nor its `source-spec` is taken from it. `problem`
 * names the decode failure briefly, on one line.
 */
export type PlanFrontmatterReading =
  | {
      readonly kind: "decoded";
      readonly status: PlanFrontmatter["status"];
      readonly sourceSpec: SourceSpecDeclaration;
    }
  | { readonly kind: "none" }
  | { readonly kind: "undecodable"; readonly problem: string };

// The first non-blank line of a decode failure, trimmed: YAML syntax errors
// carry a code excerpt after it, schema failures one indented line per issue.
function briefProblem(detail: string): string {
  return (
    detail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "no detail"
  );
}

export function readPlanFrontmatter(md: string): PlanFrontmatterReading {
  const decoded = decodeArtifactFrontmatter("plan", md);
  if (Either.isLeft(decoded)) {
    const problem = decoded.left;
    switch (problem.kind) {
      case "missing-block":
        return { kind: "none" };
      case "yaml-syntax":
        return { kind: "undecodable", problem: `invalid YAML: ${briefProblem(problem.detail)}` };
      case "schema":
        return { kind: "undecodable", problem: briefProblem(problem.detail) };
    }
  }
  const frontmatter = decoded.right;
  return {
    kind: "decoded",
    status: frontmatter.status,
    sourceSpec:
      frontmatter["source-spec"] === null
        ? { kind: "none" }
        : {
            kind: "spec",
            path: frontmatter["source-spec"],
            completesSpec: frontmatter["completes-spec"],
          },
  };
}

export interface CompletesSpecFlags {
  readonly hasSourceSpec: boolean;
  readonly last: boolean;
  readonly notLast: boolean;
}

// The `artifact new plan` pairing rule: with `--spec`, exactly one of `--last`
// (true) or `--not-last` (false); without it, neither (null). Never inferred.
export function resolveCompletesSpec(
  flags: CompletesSpecFlags,
): Either.Either<boolean | null, string> {
  const { hasSourceSpec, last, notLast } = flags;
  if (!hasSourceSpec) {
    if (last || notLast) {
      const given = last ? "--last" : "--not-last";
      return Either.left(`${given} needs --spec: a plan without a source spec completes none`);
    }
    return Either.right(null);
  }
  if (last && notLast) {
    return Either.left("--last and --not-last are opposites: pass exactly one with --spec");
  }
  if (!last && !notLast) {
    return Either.left(
      "--spec needs --last (this plan is the spec's last) or --not-last (more plans follow)",
    );
  }
  return Either.right(last);
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

// Removes the `approved` frontmatter mapping, the mirror of stampApproved. Used
// on reopen so a Draft plan no longer stamps an approval of text about to be
// rewritten. Fingerprint-neutral: fingerprintSource already deletes `approved`
// before hashing, so clearing it never changes the plan's approval fingerprint.
export function clearApproved(md: string): Either.Either<string, FrontmatterProblem> {
  return removeFrontmatterKeys(md, ["approved"]);
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
  // The repo-relative path of the plan being judged.
  readonly planPath: string;
  readonly record: ApprovalRecordLike | null;
  readonly baselineExists: boolean;
  readonly currentPlanFingerprint: string;
  readonly currentSpecFingerprint: string | null;
  readonly changedFilesSinceBaseline: readonly string[];
  readonly footprint: readonly string[];
}

/**
 * The `spec-changed` evidence of a plan whose approval recorded its source
 * spec at a fingerprint the spec's current text no longer has; null when the
 * plan recorded no spec, the spec's fingerprint is unknown, or it still matches.
 */
export function specChangedEvidence(
  recordedSpec: ApprovalRecordLike["sourceSpec"],
  currentSpecFingerprint: string | null,
): Extract<StalenessEvidence, { readonly reason: "spec-changed" }> | null {
  if (recordedSpec === null || currentSpecFingerprint === null) return null;
  if (recordedSpec.fingerprint === currentSpecFingerprint) return null;
  return { reason: "spec-changed", specPath: recordedSpec.path };
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

  const specChanged = specChangedEvidence(record.sourceSpec, input.currentSpecFingerprint);
  if (specChanged !== null) evidence.push(specChanged);

  // The plan's own content is judged by self-changed through its fingerprint,
  // and its own record file is written only by its own transitions, so neither
  // counts as ground. Another artifact's record and the plan's own sidecar still do.
  const ownRecordPath = approvalRecordPathFor("plan", input.planPath);
  const notGround = new Set(
    ownRecordPath === null ? [input.planPath] : [input.planPath, ownRecordPath],
  );
  const footprintSet = new Set(input.footprint);
  const groundChanged = input.changedFilesSinceBaseline.filter(
    (file) => !notGround.has(file) && footprintSet.has(file),
  );
  if (groundChanged.length > 0) {
    evidence.push({ reason: "ground-changed", baseline: record.baseline, files: groundChanged });
  }

  if (record.planFingerprint !== input.currentPlanFingerprint) {
    evidence.push({ reason: "self-changed" });
  }

  if (evidence.length === 0) return { kind: "fresh" };
  return { kind: "stale", evidence };
}

export type SpecApprovalVerdict =
  | { readonly kind: "unrecorded" }
  | { readonly kind: "recorded"; readonly editedSinceApproval: boolean };

export function specApprovalVerdict(
  record: { readonly specFingerprint: string } | null,
  currentFingerprint: string,
): SpecApprovalVerdict {
  return approvalVerdict(record === null ? null : record.specFingerprint, currentFingerprint);
}

/**
 * A spec's or plan's approval against its current text: unrecorded without a
 * recorded fingerprint, else whether the text was edited since.
 */
export function approvalVerdict(
  recordedFingerprint: string | null,
  currentFingerprint: string,
): SpecApprovalVerdict {
  if (recordedFingerprint === null) return { kind: "unrecorded" };
  return {
    kind: "recorded",
    editedSinceApproval: recordedFingerprint !== currentFingerprint,
  };
}
