// phax's program for the command runner (src/cli/commandLibrary/): every command, its two exit
// codes, its usage flag and header, the options every command takes and the phase guard.
// main.ts hands every call but `--usage` to the runner over this program. A file under
// src/cli/definitions/ never imports `commander`.
import * as Schema from "effect/Schema";
import { isInPhaseWorktree } from "../../app/loadConfig.js";
import { phaseGuardRefusal } from "../../domain/security/phaseGuard.js";
import { PHAX_RELEASE } from "../../schemas/release.js";
import {
  defineGroup,
  defineProgram,
  reject,
  type GuardedCall,
  type GuardRefusal,
} from "../commandLibrary/contract/index.js";
import { agentGroup } from "./agent.js";
import { architectureCommand } from "./architecture.js";
import { artifactGroup } from "./artifact.js";
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
import { recordsGroup } from "./records.js";
import { reportCommand } from "./report.js";
import { schemaGroup } from "./schema.js";
import { securityGroup } from "./security.js";
import { sessionInfoCommand } from "./sessionInfo.js";
import { skillsGroup } from "./skills.js";
import { validateCommand } from "./validate.js";
import { archiveCommand } from "./archive.js";
import { initCommand } from "./init.js";
import { publishPrCommand } from "./publishPr.js";
import { pruneCommand } from "./prune.js";
import { resetPhaseCommand } from "./resetPhase.js";
import { resumeCommand } from "./resume.js";
import { runCommand } from "./run.js";
import { reviewCodeCommand, reviewComplianceCommand, reviewHandoffCommand } from "./review.js";
import { adjustPlanCommand } from "./adjustPlan.js";
import { enterCommand, enterPhaseCommand, openCommand, shellCommand } from "./sessions.js";
import { unlockCommand } from "./unlock.js";

/** The options every phax command takes, wherever they stand in the call, with today's help. */
const phaxProgramOptions = reject(
  Schema.Struct({
    verbose: Schema.optionalKey(
      Schema.Boolean.annotations({
        description: "Print human-readable progress and system events",
      }),
    ),
    trace: Schema.optionalKey(
      Schema.Boolean.annotations({
        description: "Write structured JSONL trace events to the run folder",
      }),
    ),
  }),
);

/** The licence the usage spec declares: package.json's, which a test keeps it equal to. */
export const PHAX_LICENSE = "Apache-2.0";

/** The phase guard: inside a phase worktree, a command that acts on phax state or an artifact's
 *  lifecycle is refused with exit 1 before anything is decoded. */
function phaseGuard(call: GuardedCall): GuardRefusal | undefined {
  if (!isInPhaseWorktree(process.cwd())) return undefined;
  const refusal = phaseGuardRefusal(call.words.join(" "), call.options);
  return refusal === undefined
    ? undefined
    : { text: refusal, exit: 1, expected: "a command allowed inside a phase worktree" };
}

export const phaxProgram = defineProgram({
  name: "phax",
  version: PHAX_RELEASE,
  summary: "Drive AI coding agents through isolated, gated phases",
  license: PHAX_LICENSE,
  versionAlias: "V",
  helpCommand: true,
  guard: phaseGuard,
  exits: { refused: 64, defect: 70 },
  usage: {
    flag: "usage",
    format: "usage-format",
    jsonSchema: "program",
    help: "Print the phax.usage.kdl CLI spec and exit",
    formatHelp:
      "Format for --usage output: kdl (default, no external dependency) or json (requires the usage CLI)",
    formatDefault: "kdl",
    minUsageVersion: "1.0.0",
    groups: "plain",
    // main.ts answers `--usage` anywhere in the call, ahead of the runner.
    global: true,
  },
  options: phaxProgramOptions,
  // Written after each refusal, as phax always has.
  refusalHint: "Run `phax --help` for usage.",
  // In today's root order, which root help and the usage spec keep.
  commands: [
    validateCommand,
    unlockCommand,
    enterCommand,
    enterPhaseCommand,
    sessionInfoCommand,
    shellCommand,
    pathCommand,
    openCommand,
    lsCommand,
    archiveCommand,
    pruneCommand,
    costGroup,
    runCommand,
    reviewHandoffCommand,
    publishPrCommand,
    reviewComplianceCommand,
    reviewCodeCommand,
    adjustPlanCommand,
    briefCommand,
    architectureCommand,
    initCommand,
    reportCommand,
    completionsCommand,
    resumeCommand,
    resetPhaseCommand,
    agentGroup,
    securityGroup,
    skillsGroup,
    schemaGroup,
    artifactGroup,
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
    recordsGroup,
  ],
});
