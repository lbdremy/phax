import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { schemaUpgradeCommand } from "../definitions/schema.js";

/** `phax schema upgrade` answers through the command runner (src/cli/definitions/schema.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run and render
 *  over the OutputPort, for the tests that call it. */
export function runSchemaUpgrade(out: OutputPort): Promise<number> {
  return runThroughOutput(schemaUpgradeCommand, {}, out, { lineByLine: true });
}
