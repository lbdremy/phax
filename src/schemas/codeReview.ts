// Stub: phase-02 implements this module and derives the types from its schemas.
// The headless code review's answer contract, frozen as oracles by phase-01.
import type { Either } from "effect";

export type CodeReviewSeverity = "bug" | "deviation" | "concern" | "info";

export type CodeReviewLens =
  | "surface"
  | "acceptance"
  | "boundary"
  | "core"
  | "edge"
  | "tests"
  | "architecture"
  | "docs";

export type CodeReviewEscape =
  | "wrong-oracle"
  | "same-author"
  | "weakened"
  | "fake-drift"
  | "unexplored-input"
  | "omission"
  | "untestable";

export interface CodeReviewFinding {
  readonly severity: CodeReviewSeverity;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly lens: CodeReviewLens;
  readonly escape: CodeReviewEscape;
  readonly criterion: string | null;
  readonly suggestion: string;
}

export interface CodeReview {
  readonly findings: readonly CodeReviewFinding[];
}

export const CODE_REVIEW_SEVERITIES: readonly string[] = [];
export const CODE_REVIEW_LENSES: readonly string[] = [];
export const CODE_REVIEW_ESCAPES: readonly string[] = [];

export function readCodeReviewAnswer(_text: string): Either.Either<CodeReview, string> {
  throw new Error("not implemented: readCodeReviewAnswer");
}

export function codeReviewFileText(_review: CodeReview): string {
  throw new Error("not implemented: codeReviewFileText");
}
