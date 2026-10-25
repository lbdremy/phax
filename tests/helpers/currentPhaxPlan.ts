import { Array as Arr, Either } from "effect";
import { readPhaxPlanFile, type PhaxPlanRead } from "../../src/schemas/persisted.js";

type CurrentPhaxPlanRead = Extract<PhaxPlanRead, { readonly shape: "current" }>;

/**
 * `readPhaxPlanFile` for a fixture a run is handed, as the current plan: a
 * fixture in an older shape, which the reader never gives test lines, has
 * `testLines: []` on every phase. A test-only convenience: phax itself never
 * hands an older plan to a run (`loadPlan`).
 */
export function readCurrentPhaxPlanFile(
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
