// `review-compliance` answers through the command runner (src/cli/definitions/review.ts). This run function is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeReviewComplianceCommand } from "../definitions/review.js";

export interface ReviewComplianceCommandOptions {
  verbose?: boolean;
}

export function runReviewCompliance(
  shortNameArg: string,
  opts: ReviewComplianceCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(makeReviewComplianceCommand(), { args: [shortNameArg] }, out, {
    lineByLine: true,
    program: opts.verbose !== undefined ? { verbose: opts.verbose } : {},
  });
}
