// phax's program for the command runner (src/cli/commandLibrary/): the commands that answer
// through the runner, its two exit codes, its usage flag and the options every command takes.
// During the transition the bridge (src/cli/bridge.ts) hands a call naming one of these commands
// to the runner and every other call to the Commander program of src/cli/program.ts. A file
// under src/cli/definitions/ never imports `commander`.
import * as Schema from "effect/Schema";
import { PHAX_RELEASE } from "../../schemas/release.js";
import { defineProgram, reject } from "../commandLibrary/contract/index.js";

/** The options every phax command takes, wherever they stand in the call, with today's help. */
const phaxProgramOptions = reject(
  Schema.Struct({
    verbose: Schema.optionalWith(
      Schema.Boolean.annotations({
        description: "Print human-readable progress and system events",
      }),
      { exact: true },
    ),
    trace: Schema.optionalWith(
      Schema.Boolean.annotations({
        description: "Write structured JSONL trace events to the run folder",
      }),
      { exact: true },
    ),
  }),
);

export const phaxProgram = defineProgram({
  name: "phax",
  version: PHAX_RELEASE,
  exits: { refused: 64, defect: 70 },
  usage: { flag: "usage", format: "usage-format", jsonSchema: "program" },
  options: phaxProgramOptions,
  // phase-05 adds artifact status, plans overview, plans lint and ls.
  commands: [],
});
