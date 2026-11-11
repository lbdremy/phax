// `phax plans estimate <plan>` as the runner reads it: today's unversioned estimate report as its
// output contract, today's text rendered with the local time zone and the clock, the ledgers it
// backfilled as a progress line (printed once they are written) and the report's warnings as
// notes. The probe is a Claude Code request that never sees the plan; `--no-probe` reads the
// ledgers' last sample instead.
import { Data, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { estimatePlanCost } from "../../app/estimatePlan.js";
import type { EstimateReport } from "../../domain/cost/estimate.js";
import { renderEstimate } from "../../domain/cost/estimateRender.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { makeProviderBackendLayer, makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields, repoPaths } from "./shared.js";

/** The configuration of the invocation directory's repository cannot be read: exit 1 with
 *  `Config error: …`. An invalid model-routing.json or providers.json read later is the
 *  estimate's own ConfigValidationError, exit 2. */
class EstimateConfigError extends Data.TaggedError("EstimateConfigError")<{
  readonly message: string;
}> {}

const Usd = Schema.Number;

const UsdRange = Schema.Struct({ p10: Usd, p50: Usd, p90: Usd });

const ObservedWindow = Schema.Struct({
  utilization: Schema.Number,
  resetsAt: Schema.String,
  capacityUsd: Schema.NullOr(Usd),
});

const ReportWindows = Schema.Struct({
  source: Schema.Literals(["probe", "last-sample"]),
  observedAt: Schema.String,
  fiveHour: ObservedWindow,
  sevenDay: ObservedWindow,
});

const Scenario = Schema.Struct({
  pauses: Schema.Array(
    Schema.Struct({
      phase: Schema.String,
      window: Schema.Literals(["five-hour", "seven-day"]),
      at: Schema.String,
      resumesAt: Schema.String,
    }),
  ),
  endsAt: Schema.String,
});

const Scenarios = Schema.Struct({ p50: Scenario, p90: Scenario });

const Routing = {
  id: Schema.String,
  provider: Schema.Literals(["claude-code", "mistral-vibe", "codex-cli"]),
  model: Schema.String,
  effort: Schema.String,
};

const PhaseEstimate = Schema.Union([
  Schema.Struct({
    ...Routing,
    mode: Schema.Literals(["headless", "interactive"]),
    estimate: UsdRange,
  }),
  Schema.Struct({
    ...Routing,
    mode: Schema.Literals(["headless", "interactive"]),
    estimate: Schema.Null,
    notEstimated: Schema.Literals(["other-provider", "no-list-price", "thin-interactive-history"]),
  }),
]);

const History = Schema.Struct({
  phases: Schema.Number,
  required: Schema.Number,
  halfLifeDays: Schema.Number,
  unledgeredRuns: Schema.Number,
});

const NotEstimatedParts = Schema.Array(
  Schema.Literals([
    "plan-extraction",
    "plan-auditor",
    "interactive-code-review",
    "compliance-review",
  ]),
);

const Uncalibrated = Schema.Array(Schema.Literals(["five-hour", "seven-day", "burn-rate"]));

const Run = Schema.Struct({ p10: Usd, p50: Usd, p90: Usd, runLevel: Usd });

// The key order of each variant is the order the estimate builds it in, so that encoding
// yields today's bytes: the thin-history report puts its verdict before its phases.
const common = {
  history: History,
  notEstimated: NotEstimatedParts,
  burnRateUsdPerHour: Schema.NullOr(Usd),
  warnings: Schema.Array(Schema.String),
};

/** The output contract of `phax plans estimate`: the estimate report of today, one variant per
 *  verdict. */
export const PlansEstimateOutput = Schema.Union([
  Schema.Struct({
    ...common,
    verdict: Schema.Literal("thin-history"),
    phases: Schema.Array(PhaseEstimate),
    run: Schema.Null,
    windows: Schema.NullOr(ReportWindows),
    windowsUnavailable: Schema.Null,
    uncalibrated: Uncalibrated,
    scenarios: Schema.Null,
  }),
  Schema.Struct({
    ...common,
    phases: Schema.Array(PhaseEstimate),
    run: Run,
    verdict: Schema.Literal("no-subscription"),
    windows: Schema.Null,
    windowsUnavailable: Schema.Null,
    uncalibrated: Uncalibrated,
    scenarios: Schema.Null,
  }),
  Schema.Struct({
    ...common,
    phases: Schema.Array(PhaseEstimate),
    run: Run,
    verdict: Schema.Literal("windows-unavailable"),
    windows: Schema.Null,
    windowsUnavailable: Schema.String,
    uncalibrated: Uncalibrated,
    scenarios: Schema.Null,
  }),
  Schema.Struct({
    ...common,
    phases: Schema.Array(PhaseEstimate),
    run: Run,
    verdict: Schema.Literal("uncalibrated"),
    windows: ReportWindows,
    windowsUnavailable: Schema.Null,
    uncalibrated: Uncalibrated,
    scenarios: Schema.Null,
  }),
  Schema.Struct({
    ...common,
    phases: Schema.Array(PhaseEstimate),
    run: Run,
    verdict: Schema.Literals(["fits", "risky", "wait"]),
    windows: ReportWindows,
    windowsUnavailable: Schema.Null,
    uncalibrated: Uncalibrated,
    scenarios: Scenarios,
  }),
]);

const PlansEstimateFlags = Schema.Struct({
  noProbe: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Use the last rate-limit sample in the cost ledgers instead of a one-message Claude Code probe",
    }),
  ),
});

const message = (error: { readonly message: string }): string => error.message;

export const plansEstimateCommand = defineCommand({
  name: "estimate",
  summary: "Estimate a plan's API-list cost and whether it fits the subscription windows now",
  help: "Estimate a plan's API-list cost and whether it fits the subscription windows now. Reports P10/P50/P90 in API-list dollars for each phase and for the run, then a verdict on the Claude subscription windows left right now.\n\nHistory: the estimate is calibrated from this machine's cost ledgers. Only this repository's kept runs are sized (each phase by its planned-file bytes), and recent runs weigh more, with a half-life of 30 days. An estimate needs at least 60 sized phases; below that the verdict is thin-history and no estimate is printed. Every kept run with no ledger first gets one, as `phax cost backfill` writes it, and a line on stderr says how many were written; the report counts the kept runs still without one (a locked run is skipped).\n\nWindows: by default, one minimal Claude Code probe on the cheapest Claude model reads the five-hour and seven-day windows from its rate-limit event. The probe gets a fixed prompt and never sees the plan; it spends one small request. --no-probe uses the last rate-limit sample in the cost ledgers instead, with no request; usage since that sample is not counted. phax never reads Claude Code's credentials or its OAuth usage endpoint. Each window's dollar capacity is recalibrated from the ledgers of the last 28 days.\n\nVerdict: fits (no pause even at P90), risky (fits at P50, a pause is possible at P90), wait (a pause is expected at P50), thin-history (fewer than 60 sized phases), no-subscription (Claude Code authenticates with an API key), windows-unavailable (the windows could not be read; the reason is given) or uncalibrated (a window or the burn rate had no recent samples). An interactive phase is sized from its first and closing turns alone, from at least 3 past interactive phases with turn entries, repriced at its model and weighted by recency; it has its own row at its place in the plan, and mode: interactive in --json. A phase on a hold is part of a run, never sized. Never estimated: plan extraction, the plan auditor and the interactive code review; a phase routed to Codex or Mistral Vibe, or to a Claude model with no list price, is named and left out of the run total; the compliance review is named when it cannot be estimated.\n\nThe plan is read by the deterministic parser `phax plans lint` uses; no model reads it. A plan under docs/plans/ is first validated like any artifact. --json prints the report as one JSON document on stdout; warnings go to stderr.\n\nExit codes: 0 for any verdict; 1 for a plan the deterministic parser cannot read; 2 for an invalid phax.json, model-routing.json or providers.json; 10 for a corrupt run registry; 12 when the plan fails artifact validation.\n\nSide effects: writes cost-ledger.json in each kept run folder that has none, as `phax cost backfill` does; without --no-probe, one Claude Code request.",
  examples: [
    "phax plans estimate docs/plans/2609101200-foo-plan.md",
    "phax plans estimate docs/plans/2609101200-foo-plan.md --no-probe --json",
  ],
  input: {
    args: reject(
      Schema.Tuple([
        Schema.String.annotate({ identifier: "plan", description: "Path to the plan.md" }),
      ]),
    ),
    flags: reject(PlansEstimateFlags),
  },
  output: reject(PlansEstimateOutput),
  run: ({ input, progress }) =>
    Effect.gen(function* () {
      const config = yield* configured().pipe(
        Effect.mapError((error) => new EstimateConfigError({ message: error.message })),
      );
      // Absolutized and made repo-relative exactly as `plans lint` does.
      const { absolute, repoRelPath } = repoPaths(input.args[0], config.repoRoot);
      // The Backend is here only for the probe, which never receives the plan.
      const { report, backfilledLedgers } = yield* estimatePlanCost({
        planMdPath: absolute,
        repoRelPath,
        config,
        nowIso: new Date().toISOString(),
        probe: input.flags.noProbe !== true,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeRepoRootedFileSystemLayer(config),
            makeNodeGitLayer(),
            makeProviderBackendLayer(DEFAULT_PROVIDER_CONFIG),
            makeNodeLockLayer(config.stateRoot),
          ),
        ),
      );
      if (backfilledLedgers > 0) {
        yield* progress(
          `Wrote ${backfilledLedgers} cost ledger${backfilledLedgers === 1 ? "" : "s"} for kept runs that had none.`,
        );
      }
      // A report exits 0 whatever its verdict.
      return report;
    }).pipe(Effect.mapError(exposeMessage)),
  exits: {
    EstimateConfigError: 1,
    FsError: 1,
    PlanUnparseableError: 1,
    ConfigValidationError: 2,
    RegistryCorruptionError: 10,
    ArtifactValidationError: 12,
  },
  errors: {
    EstimateConfigError: MessageFields,
    FsError: MessageFields,
    PlanUnparseableError: Schema.Struct({ message: Schema.String, path: Schema.String }),
    ConfigValidationError: MessageFields,
    RegistryCorruptionError: MessageFields,
    ArtifactValidationError: MessageFields,
  },
  texts: {
    EstimateConfigError: (error) => `Config error: ${error.message}`,
    FsError: message,
    PlanUnparseableError: message,
    ConfigValidationError: message,
    RegistryCorruptionError: message,
    ArtifactValidationError: message,
  },
  // The contract is looser than the domain's variants (a literal count, an empty array), and the
  // run answers the domain's report: the render reads it as that.
  render: (report) =>
    renderEstimate(report as EstimateReport, {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nowMs: Date.now(),
    }),
  notes: (report) => report.warnings.map((warning) => `Warning: ${warning}`).join("\n"),
});
