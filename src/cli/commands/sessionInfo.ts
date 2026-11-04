// `phax session-info` answers through the command runner (src/cli/definitions/sessionInfo.ts).
// `runSessionInfo` is kept, until the last plan of command-contracts, as the definition's run and
// render over the OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { sessionInfoCommand } from "../definitions/sessionInfo.js";

export function runSessionInfo(
  shortNameArg: string,
  out: OutputPort,
  opts: { debug?: boolean } = {},
): Promise<number> {
  return runThroughOutput(
    sessionInfoCommand,
    { args: [shortNameArg], flags: opts.debug === true ? { debug: true } : {} },
    out,
    { lineByLine: true },
  );
}
