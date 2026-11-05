// `review-handoff` answers through the command runner (src/cli/definitions/review.ts). This run function is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeReviewHandoffCommand } from "../definitions/review.js";

export interface ReviewHandoffCommandOptions {
  allowPartial?: boolean;
}

export function runReviewHandoff(
  shortNameArg: string,
  opts: ReviewHandoffCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(
    makeReviewHandoffCommand(),
    {
      args: [shortNameArg],
      flags: opts.allowPartial !== undefined ? { allowPartial: opts.allowPartial } : {},
    },
    out,
    { lineByLine: true },
  );
}
