// `phax plans lint <plan>` as the runner reads it: the plan-lint document, today's report as its
// text, and verdict 1 when a finding is an error. Its run reads the filesystem and the shell
// only, no Backend, so the lint cannot reach a model.
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { lintPlan } from "../../app/lintPlan.js";
import { hasLintErrors } from "../../domain/plan/lint.js";
import { renderLintReport } from "../../domain/plan/lintRender.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import { PlanLintFileSchema } from "../../schemas/planLint.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields, publishedFormat, repoPaths } from "./shared.js";

/** The plan argument of `plans lint` and `plans overview`, named `plan`. */
export const PlanArgs = reject(
  Schema.Tuple(
    Schema.String.annotations({ identifier: "plan", description: "Path to the plan.md" }),
  ),
);

export const plansLintCommand = defineCommand({
  name: "lint",
  summary: "Report a plan's mechanical defects without running it",
  help: "Reports every mechanical defect of a plan.md that phax can establish before a run, as findings with a severity (error or warning), a check, and the phase they concern.\n\nEight checks run: structure — every field the deterministic extraction requires, reported in full rather than stopping at the first; files — the planned create/edit lists walked in phase order against the working tree, so an edit of a file no earlier phase creates, a create of a file that already exists or was already created, and a phase that both creates and edits a path are errors (a path listed both to create and as optional is the one warning; optional files are never checked); commands — the plan's required commands against security.agentCommands and the gate profile; models — each phase's model and effort against the routing catalog, with alternatives when one is refused, each assignment bound of phax.json against the catalog, and each phase against the first bound that matches a file it plans to touch (or the policy default when none does): a departure without an **Assignment reason:** line is an error against a bound and a warning against the default, and a **Model reason:** line is an error (the label is now **Assignment reason:**); when a bound names an architecture part, the architecture provider runs once to resolve it; interactive and acceptance — a malformed **Mode:** or **Acceptance phase:** line is an error; so are the interactive-phase rules: an interactive phase that is the first or the last phase, one that directly follows another interactive phase, and one that plans a file to create or edit (its optional files name what the person may touch); and so are the acceptance-phase rules: an **Acceptance phase:** line without **Acceptance test files:** (or the reverse), a passing phase that is not later in the plan or does not exist, a phase that is both an acceptance phase and a passing phase or passes more than one acceptance phase, an acceptance test file listed more than once on the **Acceptance test files:** line, an acceptance test file that is not a planned file of the acceptance phase or that a phase in between plans, an interactive phase in a role (one between the pair is allowed), and an acceptance phase when no acceptance provider is configured (the provider is never spawned by lint); tests — a test line off the format is an error, one per phase naming its first departing line, and the other checks run on the plan without the departing lines; so are an acceptance-loop line on a phase that is not an acceptance phase, an acceptance phase with no acceptance-loop line (a phase with no test line at all included), and a criterion id the source spec's sidecar lacks; a criterion no line names is a warning, and so is a source spec whose criterion ids cannot be read (no sidecar, not found, a sidecar that does not read, or a source-spec that is not a spec path under docs/specs/, which is never read), in which case no criterion id is checked. The source spec's JSON sidecar is read in any shape, from docs/specs/archive/ when the spec has moved there; a plan with no source spec checks no criterion, and a loose plan.md whose frontmatter does not decode gets one warning naming the problem and checks no criterion. A phase with nothing to test is not flagged; advisory — when phax.json registers a planAuditor, phax writes the plan projection (the ordered phases, each with its planned create/edit files, and nothing else) to that command's stdin and reports every finding it returns as a warning naming the phases it concerns; a failing auditor is a single warning, and so is one that outruns the 30s cap phax spawns it under; with no auditor, or a plan the parser cannot read, there are no advisory findings. Advisory findings never affect the exit code.\n\nA plan under docs/plans/ is first validated like any artifact (a name off <YYMMDDHHMM>-<slug>-plan.md, an invalid frontmatter block or a status/location disagreement refuses with exit code 12), and a slug that differs from its source spec's slug is a structure error; a loose plan.md outside docs/plans/ is exempt from both.\n\nThe file-plan ground is the working tree as it is now, not any commit. Read-only and model-free: it never writes, never reads the extraction cache and never falls back to the extraction model, so a plan the deterministic parser cannot read reports its structural errors and stops. Exits 1 when at least one finding is an error, 0 otherwise (warnings alone do not fail). An invalid config, a malformed bound or a user overlay that carries assignments included, exits 2.\n\nSide effects: none of phax's own; a registered plan auditor is spawned once with the projection on stdin, capped at 30s.",
  examples: [
    "phax plans lint docs/plans/2609101200-foo-plan.md",
    "phax plans lint docs/plans/2609101200-foo-plan.md --json",
  ],
  input: { args: PlanArgs },
  output: reject(PlanLintFileSchema.annotations(publishedFormat("plan-lint"))),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const [plan] = input.args;
      const { absolute, repoRelPath } = repoPaths(plan, config.repoRoot);
      const report = yield* lintPlan({
        planMdPath: absolute,
        reportPath: plan,
        repoRelPath,
        config,
      }).pipe(
        Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeShellLayer)),
      );
      return withSchemaUrl("plan-lint", report);
    }).pipe(Effect.mapError(exposeMessage)),
  // An invalid config exits 2, as everywhere: exit 1 means the plan has an error.
  exits: { ConfigValidationError: 2, FsError: 1, ArtifactValidationError: 12 },
  errors: {
    ConfigValidationError: MessageFields,
    FsError: MessageFields,
    ArtifactValidationError: MessageFields,
  },
  texts: {
    ConfigValidationError: (error) => `Config error: ${error.message}`,
    FsError: (error) => error.message,
    ArtifactValidationError: (error) => error.message,
  },
  verdicts: { 1: (report) => hasLintErrors(report.findings) },
  render: (report) => renderLintReport(report),
});
