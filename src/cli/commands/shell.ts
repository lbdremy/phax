// `shell` answers through the command runner (src/cli/definitions/sessions.ts). This run function is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeShellCommand } from "../definitions/sessions.js";

export function runShell(shortNameArg: string, out: OutputPort): Promise<number> {
  return runThroughOutput(makeShellCommand(), { args: [shortNameArg] }, out, { lineByLine: true });
}
