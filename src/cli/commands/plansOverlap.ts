import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { plansOverlapCommand } from "../definitions/plansOverlap.js";

interface PlansOverlapCommandOptions {
  readonly json?: true;
  readonly noExtract?: true;
  readonly landed?: string;
}

/** `phax plans overlap` answers through the command runner (src/cli/definitions/plansOverlap.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run, render and
 *  sentences over the OutputPort, for the tests that call it. */
export function runPlansOverlap(
  planMdPaths: string[],
  opts: PlansOverlapCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(
    plansOverlapCommand,
    {
      args: planMdPaths,
      flags: {
        ...(opts.noExtract === true ? { noExtract: true } : {}),
        ...(opts.landed !== undefined ? { landed: opts.landed } : {}),
      },
    },
    out,
    { json: opts.json === true },
  );
}
