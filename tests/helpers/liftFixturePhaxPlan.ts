import { Array as Arr, Either } from "effect";
import { readPhaxPlanFile, type PhaxPlanRead } from "../../src/schemas/persisted.js";

type CurrentPhaxPlanRead = Extract<PhaxPlanRead, { readonly shape: "current" }>;

/**
 * Lifts a test fixture to the current `phax-plan.json` shape: `readPhaxPlanFile`,
 * then a fixture written in an older shape gets `testLines: []` on every phase.
 * A test-only convenience for fixtures that predate test lines; phax itself
 * never hands an older plan to a run (`loadPlan`).
 */
export function liftFixturePhaxPlanToCurrent(
  file: string,
  input: unknown,
): Either.Either<CurrentPhaxPlanRead, unknown> {
  return Either.map(readPhaxPlanFile(file, input), (read): CurrentPhaxPlanRead => {
    if (read.shape === "current") return read;
    const { run, phases } = read.plan;
    return {
      shape: "current",
      plan: {
        run,
        phases: Arr.map(phases, ({ commit, ...phase }) => ({ ...phase, testLines: [], commit })),
      },
    };
  });
}
