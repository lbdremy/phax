import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { plansLintCommand } from "../definitions/plansLint.js";
import { plansStatusCommand } from "../definitions/plansStatus.js";

interface PlansStatusCommandOptions {
  readonly apply?: true;
  readonly json?: true;
}

/** `phax plans status` answers through the command runner (src/cli/definitions/plansStatus.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run, render and
 *  notes over the OutputPort, for the tests that call it. */
export function runPlansStatus(opts: PlansStatusCommandOptions, out: OutputPort): Promise<number> {
  return runThroughOutput(
    plansStatusCommand,
    { flags: opts.apply === true ? { apply: true } : {} },
    out,
    { json: opts.json === true },
  );
}

interface PlansLintCommandOptions {
  readonly json?: true;
}

/** `phax plans lint` answers through the command runner (src/cli/definitions/plansLint.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run, render and
 *  verdict over the OutputPort, for the tests that call it. */
export function runPlansLint(
  plan: string,
  opts: PlansLintCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(plansLintCommand, { args: [plan] }, out, { json: opts.json === true });
}
