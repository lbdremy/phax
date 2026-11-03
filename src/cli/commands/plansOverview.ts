// `phax plans overview` answers through the command runner
// (src/cli/definitions/plansOverview.ts). `runPlansOverview` is kept, until the last plan of
// command-contracts, as the definition's run, render and notes over the OutputPort, for the
// tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { plansOverviewCommand } from "../definitions/plansOverview.js";

export interface PlansOverviewCommandOptions {
  readonly json?: true;
}

export function runPlansOverview(
  plan: string,
  opts: PlansOverviewCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(plansOverviewCommand, { args: [plan] }, out, {
    json: opts.json === true,
  });
}
