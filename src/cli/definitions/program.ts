// phax's program for the command runner (src/cli/commandLibrary/): the commands that answer
// through the runner, its two exit codes, its usage flag and the options every command takes.
// During the transition the bridge (src/cli/bridge.ts) hands a call naming one of these commands
// to the runner and every other call to the Commander program of src/cli/program.ts. A file
// under src/cli/definitions/ never imports `commander`.
import * as Schema from "effect/Schema";
import { PHAX_RELEASE } from "../../schemas/release.js";
import { defineGroup, defineProgram, reject } from "../commandLibrary/contract/index.js";
import { artifactStatusCommand } from "./artifactStatus.js";
import { lsCommand } from "./ls.js";
import { plansLintCommand } from "./plansLint.js";
import { plansOverviewCommand } from "./plansOverview.js";

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
  // In the order the Commander program lists them, so that help and the usage spec keep their
  // positions. A group holds only its migrated commands: Commander keeps the group itself, with
  // its other commands, until the last of them moves.
  commands: [
    lsCommand,
    defineGroup({
      name: "artifact",
      summary: "Inspect and transition the lifecycle status of a spec or plan",
      commands: [artifactStatusCommand],
    }),
    defineGroup({
      name: "plans",
      summary:
        "Lint, estimate and lay out a plan, and report plan staleness and cross-plan overlap",
      commands: [plansLintCommand, plansOverviewCommand],
    }),
  ],
});
