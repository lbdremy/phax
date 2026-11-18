// The findings of a run, numbered. A run's reviews of one kind, oldest first,
// carry run-unique ids: `F<n>` for a code-review finding, `C<n>` for a
// compliance finding (spec finding-ids-and-fates §5.1). A review persisted with
// ids keeps them; one persisted before ids has none, and gets them by position,
// after the highest id the reviews before it hold (§5.4). Pure: it reads no
// file, so the persist side and the list side fold the same reviews alike.
import type {
  CodeReview,
  CodeReviewFinding,
  PersistedCodeReview,
  PersistedCodeReviewFinding,
} from "../../schemas/codeReview.js";
import type {
  AnyShapeComplianceReview,
  ComplianceReview,
  Dimension,
  PersistedComplianceReview,
  Severity,
} from "../../schemas/complianceReview.js";
import type { FindingFate } from "../../schemas/findingList.js";

/** One review of a run, as read: with the ids it was persisted with, or without. */
export type RunReview =
  | {
      readonly source: "code-review";
      readonly ids: "persisted";
      readonly review: PersistedCodeReview;
    }
  | { readonly source: "code-review"; readonly ids: "absent"; readonly review: CodeReview }
  | {
      readonly source: "compliance-review";
      readonly ids: "persisted";
      readonly review: PersistedComplianceReview;
    }
  | {
      readonly source: "compliance-review";
      readonly ids: "absent";
      readonly review: AnyShapeComplianceReview;
    };

/** Where a finding's id comes from: the file that holds it, or the position it is lifted to. */
type FindingOrigin = "persisted" | "lifted";

/** A code-review finding of a run: its id, where the id comes from, and what it says. */
interface RunCodeFinding extends CodeReviewFinding {
  readonly id: string;
  readonly source: "code-review";
  readonly origin: FindingOrigin;
}

/** A compliance finding of a run: its id, where the id comes from, and what it says. */
interface RunComplianceFinding {
  readonly id: string;
  readonly source: "compliance-review";
  readonly origin: FindingOrigin;
  readonly phaseId: string;
  readonly dimension: Dimension;
  readonly severity: Severity;
  readonly message: string;
}

export type RunFinding = RunCodeFinding | RunComplianceFinding;

/**
 * What became of a finding. Until fate records exist, a finding persisted with
 * its id is `open` and one lifted by position from a review persisted before
 * ids is `unrecorded`.
 */
export function findingFate(finding: RunFinding): FindingFate {
  return finding.origin === "persisted" ? "open" : "unrecorded";
}

/** The numbered findings of a run's reviews, and the highest number given to each kind. */
interface NumberedRunFindings {
  /** F before C, each in increasing number. */
  readonly findings: readonly RunFinding[];
  /** The highest `F<n>` and `C<n>` number the reviews hold; 0 when there is none. */
  readonly highest: { readonly F: number; readonly C: number };
}

/** The number of an id of the form `<letter><n>`, or 0 for anything else. */
function numberOf(id: string): number {
  const n = Number(id.slice(1));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Increasing number of the ids of one kind. */
const byNumber = <T extends { readonly id: string }>(a: T, b: T): number =>
  numberOf(a.id) - numberOf(b.id);

/**
 * A code review given its ids: its findings numbered in document order from
 * `after + 1`.
 */
export function assignCodeReviewIds(review: CodeReview, after: number): PersistedCodeReview {
  return {
    findings: review.findings.map((finding, index): PersistedCodeReviewFinding => ({
      id: `F${after + index + 1}`,
      ...finding,
    })),
  };
}

/**
 * A compliance review given its ids: its findings numbered across `perPhase`
 * in document order, then within each phase, from `after + 1`.
 */
export function assignComplianceReviewIds(
  review: ComplianceReview,
  after: number,
): PersistedComplianceReview {
  return { ...review, perPhase: numberPhases(review.perPhase, after) };
}

function numberPhases(
  perPhase: AnyShapeComplianceReview["perPhase"],
  after: number,
): PersistedComplianceReview["perPhase"] {
  let next = after;
  return perPhase.map((phase) => ({
    ...phase,
    findings: phase.findings.map(({ dimension, severity, message }) => {
      next += 1;
      return { id: `C${next}`, dimension, severity, message };
    }),
  }));
}

/**
 * Numbers the findings of a run's reviews, given oldest first. Per kind, a
 * review persisted with ids keeps them and raises the highest number to its
 * largest; a review without ids gets ids by position after the highest so far,
 * in document order (compliance across `perPhase`, then within each phase).
 * Each kind is numbered on its own.
 */
export function numberRunFindings(reviews: readonly RunReview[]): NumberedRunFindings {
  const highest = { F: 0, C: 0 };
  const code: RunCodeFinding[] = [];
  const compliance: RunComplianceFinding[] = [];

  for (const run of reviews) {
    if (run.source === "code-review") {
      const origin: FindingOrigin = run.ids === "persisted" ? "persisted" : "lifted";
      const numbered =
        run.ids === "persisted" ? run.review : assignCodeReviewIds(run.review, highest.F);
      for (const finding of numbered.findings) {
        code.push({ ...finding, source: "code-review", origin });
        highest.F = Math.max(highest.F, numberOf(finding.id));
      }
    } else {
      const origin: FindingOrigin = run.ids === "persisted" ? "persisted" : "lifted";
      const perPhase =
        run.ids === "persisted"
          ? run.review.perPhase
          : numberPhases(run.review.perPhase, highest.C);
      for (const phase of perPhase) {
        for (const { id, dimension, severity, message } of phase.findings) {
          compliance.push({
            id,
            source: "compliance-review",
            origin,
            phaseId: phase.phaseId,
            dimension,
            severity,
            message,
          });
          highest.C = Math.max(highest.C, numberOf(id));
        }
      }
    }
  }

  return {
    findings: [...code.toSorted(byNumber), ...compliance.toSorted(byNumber)],
    highest,
  };
}
