// `phax architecture` answers through the command runner (src/cli/definitions/architecture.ts).
// `runArchitecture` is kept, until the last plan of command-contracts, as the definition's run and
// render over the OutputPort, for the tests that call it from a given directory.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { architectureSections, makeArchitectureCommand } from "../definitions/architecture.js";

export function runArchitecture(
  paths: readonly string[],
  out: OutputPort,
  cwd: string = process.cwd(),
): Promise<number> {
  return runThroughOutput(
    makeArchitectureCommand(() => cwd),
    { args: [...paths] },
    out,
    {
      sections: architectureSections,
    },
  );
}
