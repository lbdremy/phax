// `init` answers through the command runner (src/cli/definitions/init.ts). This run function is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeInitCommand, REAL_INIT_LAYERS } from "../definitions/init.js";

export function runInit(
  opts: { force?: boolean; yes?: boolean },
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(
    makeInitCommand(REAL_INIT_LAYERS),
    {
      flags: {
        ...(opts.force !== undefined ? { force: opts.force } : {}),
        ...(opts.yes !== undefined ? { yes: opts.yes } : {}),
      },
    },
    out,
    { lineByLine: true },
  );
}
