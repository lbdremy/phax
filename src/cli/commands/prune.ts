// `prune` answers through the command runner (src/cli/definitions/prune.ts). This run function is
// kept, until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it. A `--json` call that would prompt is refused as the
// runner refuses it, with the program's `refused` code, before anything runs.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makePruneCommand, PRUNE_UNPROMPTED, REAL_PRUNE_LAYERS } from "../definitions/prune.js";
import { phaxProgram } from "../definitions/program.js";

export interface PruneCommandOptions {
  all?: boolean;
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}

export function runPrune(
  names: string[],
  opts: PruneCommandOptions,
  out: OutputPort,
): Promise<number> {
  const json = opts.json === true;
  if (json && opts.yes !== true && opts.dryRun !== true) {
    out.error(`error: --json: prune prompts; ${PRUNE_UNPROMPTED}`);
    return Promise.resolve(phaxProgram.exits.refused);
  }
  return runThroughOutput(
    makePruneCommand(REAL_PRUNE_LAYERS),
    {
      args: names,
      flags: {
        ...(opts.all !== undefined ? { all: opts.all } : {}),
        ...(opts.force !== undefined ? { force: opts.force } : {}),
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
        ...(opts.yes !== undefined ? { yes: opts.yes } : {}),
      },
    },
    out,
    { json, lineByLine: true, wholeDocument: true },
  );
}
