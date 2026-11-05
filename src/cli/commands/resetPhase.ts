import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeResetPhaseCommand } from "../definitions/resetPhase.js";

export interface ResetPhaseCommandOptions {
  yes?: boolean;
  verbose?: boolean;
  trace?: boolean;
}

/** `phax reset-phase` over an OutputPort, kept for its tests until the kept run functions
 *  retire: the runner command composed with its render and sentences
 *  (src/cli/definitions/resetPhase.ts), one line at a time as before. */
export async function runResetPhase(
  shortNameArg: string,
  phaseIdArg: string | undefined,
  opts: ResetPhaseCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(
    makeResetPhaseCommand(),
    {
      args: phaseIdArg === undefined ? [shortNameArg] : [shortNameArg, phaseIdArg],
      flags: opts.yes === undefined ? {} : { yes: opts.yes },
    },
    out,
    { lineByLine: true },
  );
}
