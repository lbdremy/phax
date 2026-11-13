// The record's failure literals are exactly the reader's failure kinds plus the
// three decide values: a kind added to one without the other fails to compile.
import type { FailureKind } from "../../src/domain/session/outcome.js";
import type { DecisionFailure } from "../../src/schemas/decisionRecord.js";
import type { RevisionFailure } from "../../src/schemas/revisionRecord.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export const decisionFailureIsKindsPlusThree: Equal<
  DecisionFailure,
  FailureKind | "answer-refused" | "artifact-changed" | "commit-failed"
> = true;

// The revision record keeps its own failure literals, equal to the decision record's: neither
// moves without the other being a deliberate change.
export const revisionFailureEqualsDecisionFailure: Equal<RevisionFailure, DecisionFailure> = true;
