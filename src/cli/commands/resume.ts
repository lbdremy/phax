import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import { phaxProgram } from "../definitions/program.js";
import { makeResumeCommand, SKIP_ORACLE_RETIRED } from "../definitions/resume.js";
import { outcomeSections, type RunAnswer } from "../definitions/runOutcome.js";

export interface ResumeCommandOptions {
  yes?: boolean;
  verbose?: boolean;
  trace?: boolean;
  providerPriority?: string;
  skipAcceptance?: boolean;
  /** The retired spelling of `skipAcceptance`: read only to be refused. */
  skipOracle?: boolean;
}

/** `phax resume` over an OutputPort, kept for its tests until the kept run functions retire: the
 *  runner command composed with its render, notes and sentences (src/cli/definitions/resume.ts).
 *  The retired --skip-oracle is refused first, with its sentence and the program's `refused`
 *  code, as the runner refuses it. */
export async function runResume(
  runRefArg: string,
  opts: ResumeCommandOptions,
  out: OutputPort,
): Promise<number> {
  const { skipOracle, verbose, trace, ...flags } = opts;
  if (skipOracle === true) {
    out.error(SKIP_ORACLE_RETIRED);
    return phaxProgram.exits.refused;
  }
  return runThroughOutput(makeResumeCommand(), { args: [runRefArg], flags }, out, {
    program: {
      ...(verbose === undefined ? {} : { verbose }),
      ...(trace === undefined ? {} : { trace }),
    },
    sections: (value: RunAnswer) => outcomeSections(value, false),
  });
}
