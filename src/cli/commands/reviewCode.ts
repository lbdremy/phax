// `review-code` answers through the command runner (src/cli/definitions/review.ts). This run function is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { phaxProgram } from "../definitions/program.js";
import { makeReviewCodeCommand } from "../definitions/review.js";

export interface ReviewCodeCommandOptions {
  newSession?: boolean;
  model?: string;
  effort?: string;
  verbose?: boolean;
  headless?: boolean;
  /** `--json`: refused unless `--headless`, as the runner refuses it. */
  json?: boolean;
}

export function runReviewCode(
  shortNameArg: string,
  opts: ReviewCodeCommandOptions,
  out: OutputPort,
): Promise<number> {
  if (opts.json === true && opts.headless !== true) {
    out.error("error: --json: review-code prompts; pass --headless");
    return Promise.resolve(phaxProgram.exits.refused);
  }
  return runThroughOutput(
    makeReviewCodeCommand(),
    {
      args: [shortNameArg],
      flags: {
        ...(opts.newSession !== undefined ? { newSession: opts.newSession } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
        ...(opts.headless !== undefined ? { headless: opts.headless } : {}),
      },
    },
    out,
    { lineByLine: true, json: opts.json === true },
  );
}
