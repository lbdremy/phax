// `phax brief` answers through the command runner (src/cli/definitions/brief.ts). `runBrief` is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it from a given directory.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeBriefCommand } from "../definitions/brief.js";

export function runBrief(
  paths: readonly string[],
  out: OutputPort,
  cwd: string = process.cwd(),
): Promise<number> {
  return runThroughOutput(
    makeBriefCommand(() => cwd),
    { args: [...paths] },
    out,
  );
}
