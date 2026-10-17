import { relative, resolve, sep } from "node:path";
import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { estimatePlanCost } from "../../app/estimatePlan.js";
import { renderEstimate } from "../../domain/cost/estimateRender.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { exitCodeForError, makeRepoRootedFileSystemLayer } from "./runLayers.js";

export interface PlansEstimateCommandOptions {
  readonly json?: true;
  readonly noProbe?: true;
}

export async function runPlansEstimate(
  plan: string,
  opts: PlansEstimateCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;

  // Absolutized and made repo-relative exactly as `plans lint` does.
  const planMdPath = resolve(process.cwd(), plan);
  const repoRelPath = relative(config.repoRoot, planMdPath).split(sep).join("/");

  // The Backend is here only for the probe, which never receives the plan.
  const reportResult = await Effect.runPromise(
    estimatePlanCost({
      planMdPath,
      repoRelPath,
      config,
      nowIso: new Date().toISOString(),
      probe: opts.noProbe !== true,
    }).pipe(
      Effect.either,
      Effect.provide(
        Layer.mergeAll(
          makeRepoRootedFileSystemLayer(config),
          makeNodeGitLayer(),
          makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG),
        ),
      ),
    ),
  );
  if (Either.isLeft(reportResult)) {
    out.error(reportResult.left.message);
    return exitCodeForError(reportResult.left);
  }
  const report = reportResult.right;

  // stderr in both modes, so a --json stdout stays one document.
  for (const warning of report.warnings) out.warn(`Warning: ${warning}`);
  if (opts.json === true) {
    out.log(JSON.stringify(report, null, 2));
  } else {
    out.log(
      renderEstimate(report, {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        nowMs: Date.now(),
      }),
    );
  }
  // A report exits 0 whatever its verdict.
  return 0;
}
