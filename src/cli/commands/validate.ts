// `phax validate` answers through the command runner (src/cli/definitions/validate.ts).
// `runValidate` is kept, until the last plan of command-contracts, as the definition's run and
// render over the OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { validateCommand } from "../definitions/validate.js";

export interface ValidateOptions {
  plan?: string;
}

export function runValidate(opts: ValidateOptions, out: OutputPort): Promise<number> {
  return runThroughOutput(
    validateCommand,
    { flags: opts.plan === undefined ? {} : { plan: opts.plan } },
    out,
    { lineByLine: true },
  );
}
