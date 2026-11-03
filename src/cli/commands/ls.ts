// `phax ls` answers through the command runner (src/cli/definitions/ls.ts). `runLs` is kept,
// until the last plan of command-contracts, as the definition's run and render over the
// OutputPort, for the tests that call it.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { lsCommand } from "../definitions/ls.js";

export interface LsOptions {
  active?: boolean;
  failed?: boolean;
  reviewOpen?: boolean;
  awaitingReview?: boolean;
  archived?: boolean;
  json?: boolean;
  complete?: boolean;
}

export function runLs(opts: LsOptions, out: OutputPort): Promise<number> {
  const { json, ...flags } = opts;
  const given = Object.fromEntries(Object.entries(flags).filter(([, value]) => value === true));
  return runThroughOutput(lsCommand, { flags: given }, out, { json: json === true });
}
