import { Effect, Either, Layer } from "effect";
import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { plansStalenessReport, applyStalenessReport } from "../../app/planStaleness.js";
import {
  renderOrphanRecordWarning,
  renderStalenessReport,
  renderStalenessApply,
  type StalenessFlip,
} from "../../domain/artifact/render.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import {
  exitCodeForError,
  makeProviderBackendLayer,
  makeRepoRootedFileSystemLayer,
} from "./runLayers.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { runPlansOverlap, type PlansOverlapCommandOptions } from "./plansOverlap.js";
import { runPlansEstimate, type PlansEstimateCommandOptions } from "./plansEstimate.js";
import { mountRunnerStub, runThroughOutput } from "../bridge.js";
import { phaxProgram } from "../definitions/program.js";
import { plansLintCommand } from "../definitions/plansLint.js";

export interface PlansStatusCommandOptions {
  readonly apply?: true;
  readonly json?: true;
}

function nodeLayer(config: ResolvedConfig) {
  return Layer.mergeAll(
    makeProviderBackendLayer(DEFAULT_PROVIDER_CONFIG),
    makeRepoRootedFileSystemLayer(config),
    makeNodeGitLayer(),
    NoopSystemTelemetryLayer,
  );
}

export async function runPlansStatus(
  opts: PlansStatusCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const nowIso = new Date().toISOString();
  const reportOpts = {
    repoRoot: config.repoRoot,
    stateRoot: config.stateRoot,
    model: config.extractPlanModel,
    effort: config.extractPlanEffort,
    nowIso,
  };

  const reportResult = await Effect.runPromise(
    plansStalenessReport(reportOpts).pipe(Effect.either, Effect.provide(nodeLayer(config))),
  );
  if (Either.isLeft(reportResult)) {
    out.error(reportResult.left.message);
    return exitCodeForError(reportResult.left);
  }
  const { report, orphanRecords } = reportResult.right;
  // stderr in both modes, so a --json stdout stays one document.
  for (const orphan of orphanRecords) out.warn(renderOrphanRecordWarning(orphan));

  const applied = opts.apply === true;
  let flipped: readonly StalenessFlip[] = [];
  if (applied) {
    const applyResult = await Effect.runPromise(
      applyStalenessReport(report, { repoRoot: config.repoRoot, nowIso, commit: true }).pipe(
        Effect.either,
        Effect.provide(nodeLayer(config)),
      ),
    );
    if (Either.isLeft(applyResult)) {
      out.error(applyResult.left.message);
      return exitCodeForError(applyResult.left);
    }
    flipped = applyResult.right;
  }

  if (opts.json === true) {
    out.log(
      JSON.stringify(
        applied ? { report, orphanRecords, applied: flipped } : { report, orphanRecords },
        null,
        2,
      ),
    );
    return 0;
  }

  out.log(renderStalenessReport(report));
  if (applied) {
    out.log("");
    out.log(renderStalenessApply(flipped));
  }
  return 0;
}

export interface PlansLintCommandOptions {
  readonly json?: true;
}

/** `phax plans lint` answers through the command runner (src/cli/definitions/plansLint.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run, render and
 *  verdict over the OutputPort, for the tests that call it. */
export function runPlansLint(
  plan: string,
  opts: PlansLintCommandOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(plansLintCommand, { args: [plan] }, out, { json: opts.json === true });
}

// `plans` is the parent command; `status` and `overlap` are real nested
// subcommands (never a single space-separated command name — see the warning
// in security.ts about that collision).
export function registerPlansCommand(program: Command, out: OutputPort): void {
  const plansCmd = program
    .command("plans")
    .description(
      "Lint, estimate and lay out a plan, and report plan staleness and cross-plan overlap",
    );

  plansCmd
    .command("status")
    .description("Report every Approved plan's staleness against its recorded approval")
    .option("--apply", "Flip stale-computed plans Approved -> Stale")
    .option("--json", "Emit the report as JSON instead of a rendered table")
    .action(async (opts: { apply?: boolean; json?: boolean }) => {
      const exitCode = await runPlansStatus(
        {
          ...(opts.apply === true ? { apply: true as const } : {}),
          ...(opts.json === true ? { json: true as const } : {}),
        },
        out,
      );
      process.exit(exitCode);
    });

  plansCmd
    .command("overlap")
    .description("Report which plans can run in parallel without merge conflict")
    .argument("<plan...>", "Paths to two or more plan.md files")
    .option("--json", "Emit the overlap result as JSON instead of a report")
    .option("--no-extract", "Fail on a cache miss instead of extracting the plan.md")
    .option(
      "--landed <run>",
      "Report which of the given plans need re-adjustment after this run's actual changes",
    )
    .action(async (plans: string[], opts: { json?: true; extract?: boolean; landed?: string }) => {
      const overlapOpts: PlansOverlapCommandOptions = {
        ...(opts.json === true ? { json: true as const } : {}),
        ...(opts.extract === false ? { noExtract: true as const } : {}),
        ...(opts.landed !== undefined ? { landed: opts.landed } : {}),
      };
      const exitCode = await runPlansOverlap(plans, overlapOpts, out);
      process.exit(exitCode);
    });

  // `lint` and `overview` answer through the runner: their help-only stubs, in place.
  mountRunnerStub(plansCmd, phaxProgram, ["plans", "lint"]);
  mountRunnerStub(plansCmd, phaxProgram, ["plans", "overview"]);

  plansCmd
    .command("estimate")
    .description("Estimate a plan's API-list cost and whether it fits the subscription windows now")
    .argument("<plan>", "Path to the plan.md")
    .option("--json", "Emit the estimate as JSON")
    .option(
      "--no-probe",
      "Use the last rate-limit sample in the cost ledgers instead of a one-message Claude Code probe",
    )
    .action(async (plan: string, opts: { json?: boolean; probe?: boolean }) => {
      const estimateOpts: PlansEstimateCommandOptions = {
        ...(opts.json === true ? { json: true as const } : {}),
        ...(opts.probe === false ? { noProbe: true as const } : {}),
      };
      const exitCode = await runPlansEstimate(plan, estimateOpts, out);
      process.exit(exitCode);
    });
}
