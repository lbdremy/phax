import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import {
  defaultInstallRoots,
  makeSkillsInstallCommand,
  type SkillsInstallRoots,
} from "../definitions/skills.js";

export type { SkillsInstallRoots };

/** `phax skills install` answers through the command runner (src/cli/definitions/skills.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run, render and
 *  sentences over the OutputPort, for the tests that call it. */
export function runSkillsInstall(
  opts: { target: string; scope?: string | undefined; skill?: string | undefined },
  out: OutputPort,
  roots: SkillsInstallRoots = defaultInstallRoots(),
): Promise<number> {
  return runThroughOutput(
    makeSkillsInstallCommand(() => roots),
    {
      args: opts.skill === undefined ? [] : [opts.skill],
      flags: { target: opts.target, scope: opts.scope ?? "project" },
    },
    out,
    { lineByLine: true },
  );
}
