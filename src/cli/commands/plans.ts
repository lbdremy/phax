import { Effect, Either, Layer } from "effect";
import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { plansStalenessReport, applyStalenessReport } from "../../app/planStaleness.js";
import {
  renderStalenessReport,
  renderStalenessApply,
  type StalenessFlip,
} from "../../domain/artifact/render.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { exitCodeForError } from "./runLayers.js";
import { runPlansOverlap, type PlansOverlapCommandOptions } from "./plansOverlap.js";

export interface PlansStatusCommandOptions {
  readonly apply?: true;
  readonly json?: true;
}

function nodeLayer() {
  return Layer.mergeAll(
    makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG),
    NodeFileSystemLayer,
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
    plansStalenessReport(reportOpts).pipe(Effect.either, Effect.provide(nodeLayer())),
  );
  if (Either.isLeft(reportResult)) {
    out.error(reportResult.left.message);
    return exitCodeForError(reportResult.left);
  }
  const report = reportResult.right;

  const applied = opts.apply === true;
  let flipped: readonly StalenessFlip[] = [];
  if (applied) {
    const applyResult = await Effect.runPromise(
      applyStalenessReport(report, { repoRoot: config.repoRoot, nowIso }).pipe(
        Effect.either,
        Effect.provide(nodeLayer()),
      ),
    );
    if (Either.isLeft(applyResult)) {
      out.error(applyResult.left.message);
      return exitCodeForError(applyResult.left);
    }
    flipped = applyResult.right;
  }

  if (opts.json === true) {
    out.log(JSON.stringify(applied ? { report, applied: flipped } : { report }, null, 2));
    return 0;
  }

  out.log(renderStalenessReport(report));
  if (applied) {
    out.log("");
    out.log(renderStalenessApply(flipped));
  }
  return 0;
}

// `plans` is the parent command; `status` and `overlap` are real nested
// subcommands (never a single space-separated command name — see the warning
// in security.ts about that collision).
export function registerPlansCommand(program: Command, out: OutputPort): void {
  const plansCmd = program
    .command("plans")
    .description("Report plan staleness and cross-plan overlap");

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
}
