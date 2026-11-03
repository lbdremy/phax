// `phax plans overview <plan>` as the runner reads it: the plan-overview document, today's
// overview as its text, and the architecture provider's failure as a note. Its run reads the
// filesystem and the shell only, no Backend, so the overview cannot reach a model.
import { Data, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { planOverview, type PlanOverviewFailure } from "../../app/planOverview.js";
import { renderOverview } from "../../domain/plan/overviewRender.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { withSchemaUrl } from "../../schemas/persisted.js";
import { PlanOverviewFileSchema } from "../../schemas/planOverview.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { PlanArgs } from "./plansLint.js";
import { configured, exposeMessage, MessageFields, publishedFormat, repoPaths } from "./shared.js";

/** A plan the overview cannot lay out: unreadable, unparsable or an invalid artifact, with the
 *  one line that says so. */
class PlanOverviewFailedError extends Data.TaggedError("PlanOverviewFailedError")<{
  readonly kind: PlanOverviewFailure["kind"];
  readonly line: string;
}> {}

export const plansOverviewCommand = defineCommand({
  name: "overview",
  summary: "Lay a plan out phase by phase, with its planned files by part and its test lines",
  help: "Lays a plan out before it runs. For each phase in plan order it shows the model, effort and mode, the acceptance role (an acceptance phase and the phase that passes it, or none), the planned files to create and edit grouped by architecture part, and the test lines. It ends with the coverage of the source spec's acceptance criteria: each criterion with the phases and loops whose test lines name it (`phase-02 in-phase ×2` when two lines of a phase and loop name it), then the criteria no line names. Cost is not shown; `phax plans estimate` keeps that.\n\nThe plan is read by the deterministic parser `phax plans lint` uses; no model reads it and no model session starts. It runs in any plan status, reads the plan and the source spec's JSON sidecar (from docs/specs/archive/ when the spec has moved there), and writes nothing. A plan under docs/plans/ is first validated like any artifact.\n\nParts: when phax.json registers an architecture provider, it runs once with the plan's planned files to create and edit (the whole repository when there are none). Each file is shown under every part whose globs match it, in the report's order, and the files no part holds are shown under (no part). Without a provider the planned files are shown as they are, and the header says so. A provider that fails or is refused is not an error: the overview degrades to the planned files, prints one line on stderr, `Warning: architecture provider failed: <message>`, and exits 0.\n\nCoverage: a plan without a source spec prints no criterion coverage. A source spec with no JSON sidecar, one that is not found, a sidecar that does not read, or a source-spec that is not a spec path under docs/specs/ (never read) prints the one line `phax plans lint` reports for it, and no coverage. A loose plan.md whose frontmatter does not decode says so in its header and in that one line, and reads no source spec.\n\nA plan the deterministic parser cannot read, including one with a test line off the format, prints one line on stderr naming the plan and `phax plans lint <plan>`, and exits 1: lint says what is wrong. A plan that fails artifact validation prints the plan and that validation error on one line and exits 1; a plan file that cannot be read prints the read failure and exits 1.\n\n--json prints the overview as one versioned plan-overview document on stdout, its $schema first; a warning reaches stderr as a note line. It carries the same content as the text: frontmatter.kind is decoded (with status), none or undecodable (with problem); architecture.kind is parts, none or failed; each phase has its acceptanceRole (acceptance with passedBy, passing with acceptancePhase, or none), its placement (a list of { part, files } ending with the { part: null } entry of the unplaced files) and its testLines; coverage.kind is criteria (one entry per naming line), no-source-spec, frontmatter-undecodable or no-criterion-ids (with a reason).\n\nExit codes: 0 for an overview, a degraded architecture included; 1 for a plan that cannot be read, does not parse or fails artifact validation; 2 for an invalid phax.json.\n\nSide effects: none of its own; the architecture provider is spawned once when one is configured.",
  examples: [
    "phax plans overview docs/plans/2609101200-foo-plan.md",
    "phax plans overview docs/plans/2609101200-foo-plan.md --json",
  ],
  input: { args: PlanArgs },
  output: reject(PlanOverviewFileSchema.annotations(publishedFormat("plan-overview"))),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      const [plan] = input.args;
      const { absolute, repoRelPath } = repoPaths(plan, config.repoRoot);
      const overview = yield* planOverview({
        planMdPath: absolute,
        reportPath: plan,
        repoRelPath,
        config,
      }).pipe(
        Effect.mapError((failure) => new PlanOverviewFailedError(failure)),
        Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeShellLayer)),
      );
      return withSchemaUrl("plan-overview", overview);
    }).pipe(Effect.mapError(exposeMessage)),
  // An invalid config exits 2, as everywhere: exit 1 means the plan could not be shown.
  exits: { ConfigValidationError: 2, PlanOverviewFailedError: 1 },
  errors: {
    ConfigValidationError: MessageFields,
    PlanOverviewFailedError: Schema.Struct({
      kind: Schema.Literal("unreadable", "unparsable", "invalid-artifact"),
      line: Schema.String,
    }),
  },
  texts: {
    ConfigValidationError: (error) => `Config error: ${error.message}`,
    PlanOverviewFailedError: (error) => error.line,
  },
  render: (overview) => renderOverview(overview),
  notes: (overview) =>
    overview.architecture.kind === "failed"
      ? `Warning: architecture provider failed: ${overview.architecture.message}`
      : "",
});
