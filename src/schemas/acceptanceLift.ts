// The lifts of the acceptance rename (spec acceptance-tests): one pure function
// per renamed value or key, shared by phax's readers (src/schemas/persisted.ts)
// and the schemas package's `toLatest*` functions, so the two cannot disagree on
// the same document. Imports only `effect` and types from src/schemas, because
// the schemas package publishes it. Each function keeps every other fact as it
// was recorded.
import { Array as Arr } from "effect";
import type { PhaxPlan, PhaxPlanPhase } from "./phaxPlan.js";
import type { PlanDocument, PlanDocumentPhase } from "./planDocument.js";
import type { ExtractionPlan, PlanExtractionAnswer } from "./planExtraction.js";
import type { TestLine, TestLoop, TestSize, TestTechnique } from "./testLine.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The loop of a test line written before 0.33.0. */
export type TestLoopBeforeAcceptance = "oracle" | "in-phase";

/**
 * A test line to lift: the same coordinates in a shape before 0.33.0 (the loop
 * `oracle | in-phase`) or already in the current one. A line already in the
 * `acceptance` loop is kept, so a reader that cannot tell a shape's lines
 * apart (an empty list, a union of shapes) lifts them all the same.
 */
export interface TestLineToLift {
  readonly guarantee: string;
  readonly size: TestSize;
  readonly technique: TestTechnique;
  readonly oracle: string;
  readonly loop: TestLoopBeforeAcceptance | TestLoop;
  readonly criterion: string | null;
}

/**
 * A plan document, `$schema` dropped, whose test lines may still be in a shape
 * before 0.33.0 (0.28.0 or 0.32.0): the current document with each phase's
 * `testStrategy` widened to `TestLineToLift`.
 */
export type PlanDocumentToLift = DistributiveOmit<PlanDocument, "phases"> & {
  readonly phases: Arr.NonEmptyReadonlyArray<
    Omit<PlanDocumentPhase, "testStrategy"> & {
      readonly testStrategy: ReadonlyArray<TestLineToLift>;
    }
  >;
};

/** A phax-plan, `$schema` dropped, whose test lines may still be in a shape before 0.33.0. */
export type PhaxPlanToLift = Omit<PhaxPlan, "phases"> & {
  readonly phases: Arr.NonEmptyReadonlyArray<
    Omit<PhaxPlanPhase, "testLines"> & { readonly testLines: ReadonlyArray<TestLineToLift> }
  >;
};

/** A plan extraction answer, `$schema` dropped, whose test lines may still be in the 0.32.0 shape. */
export interface PlanExtractionToLift {
  readonly plan:
    | (Omit<ExtractionPlan, "phases"> & {
        readonly phases: Arr.NonEmptyReadonlyArray<
          Omit<ExtractionPlan["phases"][number], "testLines"> & {
            readonly testLines: ReadonlyArray<TestLineToLift>;
          }
        >;
      })
    | null;
  readonly incomplete: PlanExtractionAnswer["incomplete"];
}

/** The test loop `oracle` is now `acceptance`; `acceptance` and `in-phase` are kept. */
export function liftTestLoop(loop: TestLoopBeforeAcceptance | TestLoop): TestLoop {
  return loop === "oracle" ? "acceptance" : loop;
}

/** A test line with its loop lifted; every other coordinate kept, in its place. */
export function liftTestLine(line: TestLineToLift): TestLine {
  return { ...line, loop: liftTestLoop(line.loop) };
}

/** The lines of a list, each with its loop lifted. */
export function liftTestLines(lines: ReadonlyArray<TestLineToLift>): ReadonlyArray<TestLine> {
  return lines.map(liftTestLine);
}

/** A plan document of a shape before 0.33.0, every phase's test lines lifted. */
export function liftPlanDocumentTestLines(doc: PlanDocumentToLift): PlanDocument {
  return {
    ...doc,
    phases: Arr.map(doc.phases, (phase) => ({
      ...phase,
      testStrategy: liftTestLines(phase.testStrategy),
    })),
  };
}

/** A phax-plan of a shape before 0.33.0, every phase's test lines lifted. */
export function liftPhaxPlanTestLines(plan: PhaxPlanToLift): PhaxPlan {
  return {
    ...plan,
    phases: Arr.map(plan.phases, (phase) => ({
      ...phase,
      testLines: liftTestLines(phase.testLines),
    })),
  };
}

/** A plan extraction answer of the 0.32.0 shape, the extracted plan's test lines lifted. */
export function liftPlanExtractionTestLines(
  answer: PlanExtractionToLift,
): Omit<PlanExtractionAnswer, "$schema"> {
  const { plan, incomplete } = answer;
  return {
    plan:
      plan === null
        ? null
        : {
            ...plan,
            phases: Arr.map(plan.phases, (phase) => ({
              ...phase,
              testLines: liftTestLines(phase.testLines),
            })),
          },
    incomplete,
  };
}
