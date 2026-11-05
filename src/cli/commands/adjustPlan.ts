// `adjust-plan` answers through the command runner (src/cli/definitions/adjustPlan.ts). This run
// function is kept, until the last plan of command-contracts, as the definition's run and render
// over the OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeAdjustPlanCommand } from "../definitions/adjustPlan.js";

export { DEFAULT_EFFORT, DEFAULT_MODEL } from "../definitions/adjustPlan.js";

export interface AdjustPlanCommandOptions {
  readonly landed: string;
  readonly newSession?: boolean;
  readonly model?: string;
  readonly effort?: string;
  readonly verbose?: boolean;
}

export function runAdjustPlan(
  planPathArg: string,
  opts: AdjustPlanCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(
    makeAdjustPlanCommand(),
    {
      args: [planPathArg],
      flags: {
        landed: opts.landed,
        ...(opts.newSession !== undefined ? { newSession: opts.newSession } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
      },
    },
    out,
    { lineByLine: true },
  );
}
