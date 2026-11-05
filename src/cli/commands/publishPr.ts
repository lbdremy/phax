// `publish-pr` answers through the command runner (src/cli/definitions/publishPr.ts). This run function is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makePublishPrCommand } from "../definitions/publishPr.js";

export interface PublishPrCommandOptions {
  verbose?: boolean;
}

export function runPublishPr(
  shortNameArg: string,
  opts: PublishPrCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(makePublishPrCommand(), { args: [shortNameArg] }, out, {
    lineByLine: true,
    program: opts.verbose !== undefined ? { verbose: opts.verbose } : {},
  });
}
