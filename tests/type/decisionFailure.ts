// The record's failure literals are exactly the reader's failure kinds plus the
// three decide values: a kind added to one without the other fails to compile.
import type { FailureKind } from "../../src/domain/session/outcome.js";
import type { DecisionFailure } from "../../src/schemas/decisionRecord.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export const decisionFailureIsKindsPlusThree: Equal<
  DecisionFailure,
  FailureKind | "answer-refused" | "artifact-changed" | "commit-failed"
> = true;
