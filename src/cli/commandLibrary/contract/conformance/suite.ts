import { Cause, Effect, Exit } from "effect";
import type { Runner } from "../command.js";
import type { ConformanceReport } from "../conformanceReport.js";
import { cases } from "./cases.js";

type Entry = ConformanceReport["cases"][number];

/** Runs every case, in table order, one after the other. The Effect never fails: a case that
 *  throws, or whose runner fails or dies, is a case not held. */
export function conformance(runner: Runner): Effect.Effect<ConformanceReport> {
  return Effect.gen(function* () {
    const entries: Entry[] = [];
    for (const { id, check } of cases) {
      const exit = yield* Effect.suspend(() => check(runner)).pipe(Effect.exit);
      if (Exit.isSuccess(exit)) {
        entries.push(
          exit.value.held ? { id, held: true } : { id, held: false, why: exit.value.why },
        );
      } else {
        entries.push({
          id,
          held: false,
          why: `the runner's Effect did not succeed: ${Cause.pretty(exit.cause)}`,
        });
      }
    }
    const held = entries.filter((entry) => entry.held).length;
    return { cases: entries, held, failed: entries.length - held };
  });
}
