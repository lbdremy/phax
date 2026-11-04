// phax's program for the command runner (src/cli/commandLibrary/): the commands that answer
// through the runner, its two exit codes, its usage flag and the options every command takes.
// During the transition the bridge (src/cli/bridge.ts) hands a call naming one of these commands
// to the runner and every other call to the Commander program of src/cli/program.ts. A file
// under src/cli/definitions/ never imports `commander`.
import * as Schema from "effect/Schema";
import { PHAX_RELEASE } from "../../schemas/release.js";
import { defineGroup, defineProgram, reject } from "../commandLibrary/contract/index.js";
import { architectureCommand } from "./architecture.js";
import { artifactStatusCommand } from "./artifactStatus.js";
import { briefCommand } from "./brief.js";
import { completionsCommand } from "./completions.js";
import { costGroup } from "./cost.js";
import { lsCommand } from "./ls.js";
import { pathCommand } from "./path.js";
import { plansEstimateCommand } from "./plansEstimate.js";
import { plansLintCommand } from "./plansLint.js";
import { plansOverlapCommand } from "./plansOverlap.js";
import { plansOverviewCommand } from "./plansOverview.js";
import { plansStatusCommand } from "./plansStatus.js";
import { reportCommand } from "./report.js";
import { schemaGroup } from "./schema.js";
import { securityGroup } from "./security.js";
import { sessionInfoCommand } from "./sessionInfo.js";
import { skillsGroup } from "./skills.js";
import { validateCommand } from "./validate.js";

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
  // As the Commander program writes after each of its refusals.
  refusalHint: "Run `phax --help` for usage.",
  // In the order the Commander program lists them, so that help and the usage spec keep their
  // positions. A group the bridge holds in part (`artifact`) lists only its migrated commands:
  // Commander keeps the group itself, with its other commands, until the last of them moves.
  commands: [
    validateCommand,
    sessionInfoCommand,
    pathCommand,
    lsCommand,
    briefCommand,
    architectureCommand,
    reportCommand,
    completionsCommand,
    costGroup,
    securityGroup,
    skillsGroup,
    schemaGroup,
    defineGroup({
      name: "artifact",
      summary: "Inspect and transition the lifecycle status of a spec or plan",
      commands: [artifactStatusCommand],
    }),
    defineGroup({
      name: "plans",
      summary:
        "Lint, estimate and lay out a plan, and report plan staleness and cross-plan overlap",
      help: "Parent command for reporting on plans: the mechanical defects of a single plan (lint), a plan laid out phase by phase with its planned files by architecture part, its test lines and the coverage of its source spec's criteria (overview), a plan's API-list cost and its fit in the subscription windows (estimate), staleness of Approved plans against their recorded approval, and cross-plan file overlap.",
      examples: [
        "phax plans lint docs/plans/2609101200-foo-plan.md",
        "phax plans overview docs/plans/2609101200-foo-plan.md",
        "phax plans status",
        "phax plans overlap docs/plans/2609101031-a-plan.md docs/plans/2609101032-b-plan.md",
      ],
      commands: [
        plansStatusCommand,
        plansOverlapCommand,
        plansLintCommand,
        plansOverviewCommand,
        plansEstimateCommand,
      ],
    }),
  ],
});
