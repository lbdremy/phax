// `phax path` answers through the command runner (src/cli/definitions/path.ts). `runPath` is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { pathCommand } from "../definitions/path.js";

export function runPath(shortNameArg: string, out: OutputPort): Promise<number> {
  return runThroughOutput(pathCommand, { args: [shortNameArg] }, out, { lineByLine: true });
}
