import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { costBackfillCommand } from "../definitions/cost.js";

/** `phax cost backfill` answers through the command runner (src/cli/definitions/cost.ts); this
 *  is kept, until the last plan of command-contracts, as the definition's run and render over
 *  the OutputPort, for the tests that call it. */
export function runCostBackfill(out: OutputPort): Promise<number> {
  return runThroughOutput(costBackfillCommand, {}, out, { lineByLine: true });
}
