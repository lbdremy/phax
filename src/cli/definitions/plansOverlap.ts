// `phax plans overlap <plan...>` as the runner reads it: today's unversioned overlap object (or,
// with `--landed`, the readjustment impact) as its output contract and today's report as its
// text. A footprint's sets are arrays in the answer. The extraction on a cache miss writes no
// progress line, as it does not today.
import { resolve } from "node:path";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { analyzeLandedRunImpact, analyzePlanOverlap } from "../../app/analyzePlanOverlap.js";
import { renderPlanOverlap, renderReadjustmentImpact } from "../../domain/planOverlap/render.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeProviderBackendLayer, makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields } from "./shared.js";

const Severity = Schema.Literal("hard", "medium", "soft");

const SharedFile = Schema.Struct({
  path: Schema.String,
  severity: Severity,
  reason: Schema.String,
});

const Footprint = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  create: Schema.ReadonlySet(Schema.String),
  edit: Schema.ReadonlySet(Schema.String),
  optional: Schema.ReadonlySet(Schema.String),
  all: Schema.ReadonlySet(Schema.String),
});

/** The answer of `phax plans overlap` (predicted): today's unversioned object. */
const OverlapResult = Schema.Struct({
  footprints: Schema.Array(Footprint),
  edges: Schema.Array(
    Schema.Struct({
      a: Schema.String,
      b: Schema.String,
      shared: Schema.Array(SharedFile),
      severity: Severity,
    }),
  ),
  cleanPairs: Schema.Array(Schema.Tuple(Schema.String, Schema.String)),
  largestParallelSafeSet: Schema.Array(Schema.String),
  waves: Schema.Array(Schema.Array(Schema.String)),
  exhaustiveSearchSkipped: Schema.Boolean,
});

/** The answer of `phax plans overlap --landed <run>` (confirmed): today's unversioned object. */
const ReadjustmentImpact = Schema.Struct({
  landedLabel: Schema.String,
  impacted: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      shared: Schema.Array(SharedFile),
      severity: Severity,
    }),
  ),
  unaffected: Schema.Array(Schema.String),
});

/** The output contract of `phax plans overlap`. */
const PlansOverlapOutput = Schema.Union(OverlapResult, ReadjustmentImpact);

const PlanPath = Schema.String.annotations({
  identifier: "plan",
  description: "Paths to two or more plan.md files",
});

const PlansOverlapFlags = Schema.Struct({
  noExtract: Schema.optionalWith(
    Schema.Boolean.annotations({
      description: "Fail on a cache miss instead of extracting the plan.md",
    }),
    { exact: true },
  ),
  landed: Schema.optionalWith(
    Schema.String.annotations({
      identifier: "run",
      description:
        "Report which of the given plans need re-adjustment after this run's actual changes",
    }),
    { exact: true },
  ),
});

export const plansOverlapCommand = defineCommand({
  name: "overlap",
  summary: "Report which plans can run in parallel without merge conflict",
  help: "Reports which of two or more plans can run in parallel without a merge conflict — predicted from each plan's declared file-sets, or confirmed against a landed run's actual diff.\n\n(Predicted) Without --landed: reads each plan.md's structured form through the content-addressed extraction cache (a cold cache miss extracts once via LLM and caches the result; use --no-extract to fail on a miss instead). Unions each plan's declared phase file-sets into a per-plan footprint, intersects footprints pairwise, and reports the severity-graded conflict matrix, clean pairs, the largest fully-disjoint parallel-safe set, and a greedy wave schedule.\n\n(Confirmed) With --landed <run>: takes a run that has already produced changes and reports which of the given plans need re-adjustment because they touch a file the run actually changed. The landed run's footprint is read from its persisted global-file-reconciliation.json (the real git diff across its phases), giving actual-vs-declared impact with no false negatives.\n\nCaveats: the predicted mode reflects declared file intentions, not what agents will actually touch. Conflicts are file-level, not hunk-level — two plans editing different regions of the same file are flagged even if git would auto-merge them. Regenerated artifacts (phax.usage.kdl, docs/cli/reference.md) are a hard-conflict class.\n\nSide effects: read-only with respect to your plans; may run one LLM extraction per uncached plan.md.",
  examples: [
    "phax plans overlap docs/plans/2609101031-a-plan.md docs/plans/2609101032-b-plan.md",
    "phax plans overlap --landed my-feature docs/plans/2609101033-other-plan.md",
  ],
  input: { args: reject(Schema.NonEmptyArray(PlanPath)), flags: reject(PlansOverlapFlags) },
  output: reject(PlansOverlapOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured();
      // Absolutized against the invocation directory before it crosses the FileSystem port,
      // whose layer is rooted at the repository: a path typed on the command line means
      // "relative to where I typed it".
      const planPaths = input.args.map((plan) => resolve(process.cwd(), plan));
      const loaderOpts = {
        model: config.extractPlanModel,
        effort: config.extractPlanEffort,
        stateRoot: config.stateRoot,
        noExtract: input.flags.noExtract === true,
        nowIso: new Date().toISOString(),
      };
      const layer = Layer.mergeAll(
        makeProviderBackendLayer(DEFAULT_PROVIDER_CONFIG),
        makeRepoRootedFileSystemLayer(config),
        NoopSystemTelemetryLayer,
      );
      return input.flags.landed !== undefined
        ? yield* analyzeLandedRunImpact(
            { ref: input.flags.landed, namespace: config.namespace },
            planPaths,
            loaderOpts,
          ).pipe(Effect.provide(layer))
        : yield* analyzePlanOverlap(planPaths, loaderOpts).pipe(Effect.provide(layer));
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { ConfigValidationError: 1, AnalyzePlanOverlapError: 1 },
  errors: { ConfigValidationError: MessageFields, AnalyzePlanOverlapError: MessageFields },
  texts: {
    ConfigValidationError: (error) => `Config error: ${error.message}`,
    AnalyzePlanOverlapError: (error) => error.message,
  },
  render: (value) =>
    "footprints" in value ? renderPlanOverlap(value) : renderReadjustmentImpact(value),
});
