import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { makeRunCommand } from "../definitions/run.js";
import { outcomeSections, type RunAnswer } from "../definitions/runOutcome.js";

export { pickGateProfileId } from "../definitions/run.js";

export interface RunCommandOptions {
  shortName?: string;
  plan: string;
  dryRun?: boolean;
  allowDirty?: boolean;
  allowSkillEdits?: boolean;
  /** `--hold [selection]`: `true` for a bare flag, else the value given. */
  hold?: true | string;
  providerPriority?: string;
  security?: string;
  refresh?: boolean;
  verbose?: boolean;
  trace?: boolean;
}

/** `phax run` over an OutputPort, kept for its tests until the kept run functions retire: the
 *  runner command composed with its render, notes and sentences (src/cli/definitions/run.ts). */
export async function runRun(opts: RunCommandOptions, out: OutputPort): Promise<number> {
  const { shortName, verbose, trace, ...flags } = opts;
  return runThroughOutput(
    makeRunCommand(),
    { args: shortName === undefined ? [] : [shortName], flags },
    out,
    {
      program: {
        ...(verbose === undefined ? {} : { verbose }),
        ...(trace === undefined ? {} : { trace }),
      },
      sections: (value: RunAnswer) => outcomeSections(value, true),
    },
  );
}
