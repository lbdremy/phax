// `enter-phase` answers through the command runner (src/cli/definitions/sessions.ts). This run
// function is kept, until the last plan of command-contracts, as the definition's run and render
// over the OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeEnterPhaseCommand } from "../definitions/sessions.js";

export interface EnterPhaseCommandOptions {
  newSession?: boolean;
}

export function runEnterPhase(
  shortNameArg: string,
  phaseId: string,
  out: OutputPort,
  opts: EnterPhaseCommandOptions = {},
): Promise<number> {
  return runThroughOutput(
    makeEnterPhaseCommand(),
    {
      args: [shortNameArg, phaseId],
      flags: opts.newSession !== undefined ? { newSession: opts.newSession } : {},
    },
    out,
    { lineByLine: true },
  );
}
