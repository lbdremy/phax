// The lifts of the acceptance rename (spec acceptance-tests): one pure function
// per renamed value or key, shared by phax's readers (src/schemas/persisted.ts)
// and the schemas package's `toLatest*` functions, so the two cannot disagree on
// the same document. Imports only `effect` and types from src/schemas, because
// the schemas package publishes it. Each function keeps every other fact as it
// was recorded.
import { Array as Arr } from "effect";
import type { PhaseAcceptance, PhaxPlan, PhaxPlanPhase } from "./phaxPlan.js";
import type { PlanDocument, PlanDocumentPhase } from "./planDocument.js";
import type { ExtractionPlan, PlanExtractionAnswer } from "./planExtraction.js";
import type { TestLine, TestLoop, TestSize, TestTechnique } from "./testLine.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A phase's acceptance tests as a shape before 0.33.0 recorded them: the `oracle` key. */
export interface PhaseOracleToLift {
  readonly dischargedBy: string;
  readonly files: ReadonlyArray<string>;
}

/**
 * A phase's key to lift: `oracle: { dischargedBy, files } | null` as a shape
 * before 0.33.0 wrote it, or `acceptance: { passedBy, files } | null` already.
 * A phase already in the current shape is kept, so a reader that cannot tell a
 * shape's phases apart lifts them all the same.
 */
export type PhaseKeyToLift =
  | { readonly oracle: PhaseOracleToLift | null }
  | { readonly acceptance: PhaseAcceptance };

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
    Omit<PlanDocumentPhase, "testStrategy" | "acceptance"> &
      PhaseKeyToLift & { readonly testStrategy: ReadonlyArray<TestLineToLift> }
  >;
};

/**
 * A phax-plan, `$schema` dropped, whose phases may still be in a shape before
 * 0.33.0: the `oracle` key and test lines in the loop `oracle | in-phase`.
 */
export type PhaxPlanToLift = Omit<PhaxPlan, "phases"> & {
  readonly phases: Arr.NonEmptyReadonlyArray<
    Omit<PhaxPlanPhase, "testLines" | "acceptance"> &
      PhaseKeyToLift & { readonly testLines: ReadonlyArray<TestLineToLift> }
  >;
};

/**
 * A phax-plan, `$schema` dropped, that carries no `testLines` (a plan an
 * earlier release extracted, shown or sized, never resumed), whose phases may
 * still have the `oracle` key.
 */
export type PhaxPlanWithoutTestLinesToLift = Omit<PhaxPlan, "phases"> & {
  readonly phases: Arr.NonEmptyReadonlyArray<
    Omit<PhaxPlanPhase, "testLines" | "acceptance"> & PhaseKeyToLift
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

/**
 * A phase's acceptance tests lifted: `{ dischargedBy, files }` becomes
 * `{ passedBy, files }` and null stays null. An `{ passedBy, files }` is kept.
 */
export function liftPhaseAcceptance(oracle: PhaseOracleToLift | PhaseAcceptance): PhaseAcceptance {
  if (oracle === null) return null;
  if ("passedBy" in oracle) return oracle;
  return { passedBy: oracle.dischargedBy, files: oracle.files };
}

/**
 * A phase with its `oracle` key renamed `acceptance` and its value lifted
 * (`liftPhaseAcceptance`), in the key's own position; a phase already carrying
 * `acceptance` is returned as it is. Every other key and value is kept, in order.
 */
export function liftPhaseKey<P extends object>(
  phase: P & PhaseKeyToLift,
): Omit<P, "oracle" | "acceptance"> & { readonly acceptance: PhaseAcceptance } {
  const entries = Object.entries(phase).map(([key, value]): [string, unknown] =>
    key === "oracle"
      ? ["acceptance", liftPhaseAcceptance(value as PhaseOracleToLift | null)]
      : [key, value],
  );
  // `Object.fromEntries` loses the key types; the entries above rebuild exactly them.
  return Object.fromEntries(entries) as Omit<P, "oracle" | "acceptance"> & {
    readonly acceptance: PhaseAcceptance;
  };
}

/** A plan document of a shape before 0.33.0: every phase's key and test lines lifted. */
export function liftPlanDocument(doc: PlanDocumentToLift): PlanDocument {
  return {
    ...doc,
    phases: Arr.map(doc.phases, (phase) =>
      liftPhaseKey({ ...phase, testStrategy: liftTestLines(phase.testStrategy) }),
    ),
  };
}

/** A phax-plan of a shape before 0.33.0: every phase's key and test lines lifted. */
export function liftPhaxPlan(plan: PhaxPlanToLift): PhaxPlan {
  return {
    ...plan,
    phases: Arr.map(plan.phases, (phase) =>
      liftPhaseKey({ ...phase, testLines: liftTestLines(phase.testLines) }),
    ),
  };
}

/** A phax-plan without `testLines` of a shape before 0.33.0: every phase's key lifted. */
export function liftPhaxPlanWithoutTestLines(plan: PhaxPlanWithoutTestLinesToLift): Omit<
  PhaxPlan,
  "phases"
> & {
  readonly phases: Arr.NonEmptyReadonlyArray<Omit<PhaxPlanPhase, "testLines">>;
} {
  return { ...plan, phases: Arr.map(plan.phases, (phase) => liftPhaseKey(phase)) };
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
