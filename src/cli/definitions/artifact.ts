// `phax artifact` as the runner holds it, whole: every command of the group in today's order, the
// nested `new` group with `spec` and `plan`, and the retired `archive`, refused with the sentence
// that names its replacement. The commands that run a session are built with the real adapters.
import { defineGroup } from "../commandLibrary/contract/index.js";
import { makeArtifactDecideCommand } from "./artifactDecide.js";
import {
  artifactMigrateApprovalsCommand,
  artifactMigrateDocumentsCommand,
} from "./artifactMigrations.js";
import { makeArtifactNewPlanCommand, makeArtifactNewSpecCommand } from "./artifactNew.js";
import { makeArtifactReviseCommand } from "./artifactRevise.js";
import { artifactSchemaCommand } from "./artifactSchema.js";
import { artifactStatusCommand } from "./artifactStatus.js";
import {
  artifactAbandonCommand,
  artifactApproveCommand,
  artifactCompleteCommand,
  artifactReopenCommand,
  artifactStaleCommand,
} from "./artifactTransitions.js";

/** The sentence `phax artifact archive` is refused with: the verb is retired. */
export const ARCHIVE_RETIRED =
  'unknown transition "archive" — the completion transition is: phax artifact complete <path>';

export const artifactGroup = defineGroup({
  name: "artifact",
  summary: "Inspect and transition the lifecycle status of a spec or plan",
  help: "Parent command for inspecting and transitioning the lifecycle status of a spec (docs/specs/) or plan (docs/plans/). Specs carry Draft, Approved, Abandoned, or Completed; plans additionally carry Stale. Transitioning to a terminal status (Abandoned, Completed) moves the file into the artifact's archive/ subdirectory as part of the transition. A headless-authored artifact's JSON document sidecar (<name>.json beside the .md) travels with it: every transition's write-set includes it, and a terminal transition moves it into archive/ alongside the .md. Illegal transitions and validation failures (missing frontmatter block, unknown status, status/location disagreement) refuse with exit code 12.",
  examples: ["phax artifact status docs/plans/2607101056-typescript-7-migration-plan.md"],
  retired: { archive: ARCHIVE_RETIRED },
  commands: [
    artifactStatusCommand,
    artifactApproveCommand,
    artifactStaleCommand,
    artifactAbandonCommand,
    artifactCompleteCommand,
    artifactReopenCommand,
    makeArtifactDecideCommand(),
    makeArtifactReviseCommand(),
    defineGroup({
      name: "new",
      summary: "Create a Draft spec or plan named from the current UTC minute",
      help: "Parent command for creating a Draft spec or plan named from the current UTC minute: <YYMMDDHHMM>-<slug>.md for a spec, <YYMMDDHHMM>-<slug>-plan.md for a plan. The instant is captured when the command runs, never chosen or backdated. A bad slug, an existing target name, or (for a plan) a --spec that is missing or not a spec, a --spec without exactly one of --last/--not-last, or either flag without --spec all refuse with exit code 12 before anything is written.",
      examples: ["phax artifact new spec plan-prune"],
      commands: [makeArtifactNewSpecCommand(), makeArtifactNewPlanCommand()],
    }),
    artifactSchemaCommand,
    artifactMigrateApprovalsCommand,
    artifactMigrateDocumentsCommand,
  ],
});
