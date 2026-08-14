import { resolve } from "node:path";
import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { analyzePlanOverlap, analyzeReadjustmentImpact } from "../../app/analyzePlanOverlap.js";
import { renderPlanOverlap, renderReadjustmentImpact } from "../../domain/planOverlap/render.js";
import type {
  PlanOverlapResult,
  PlanFootprint,
  ReadjustmentImpactResult,
} from "../../domain/planOverlap/types.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { decodeShortName } from "../../domain/branded.js";
import { resolveRun } from "../../app/resolveRunInfo.js";
import { makeRepoRootedFileSystemLayer } from "./runLayers.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";

export interface PlansOverlapCommandOptions {
  readonly json?: true;
  readonly noExtract?: true;
  readonly landed?: string;
}

function footprintToJson(fp: PlanFootprint) {
  return {
    id: fp.id,
    label: fp.label,
    create: [...fp.create],
    edit: [...fp.edit],
    optional: [...fp.optional],
    all: [...fp.all],
  };
}

function nodeLayer(config: ResolvedConfig) {
  return Layer.mergeAll(
    makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG),
    makeRepoRootedFileSystemLayer(config),
    NoopSystemTelemetryLayer,
  );
}

function resultToJson(result: PlanOverlapResult) {
  return {
    footprints: result.footprints.map(footprintToJson),
    edges: result.edges,
    cleanPairs: result.cleanPairs.map((pair) => [...pair]),
    largestParallelSafeSet: result.largestParallelSafeSet,
    waves: result.waves.map((wave) => [...wave]),
    exhaustiveSearchSkipped: result.exhaustiveSearchSkipped,
  };
}

function impactToJson(result: ReadjustmentImpactResult) {
  return {
    landedLabel: result.landedLabel,
    impacted: result.impacted,
    unaffected: result.unaffected,
  };
}

export async function runPlansOverlap(
  planMdPaths: string[],
  opts: PlansOverlapCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;

  // Absolutize each plan path against the invocation directory before it crosses
  // the FileSystem port. The layer is rooted at repoRoot, so a bare relative arg
  // would otherwise be reinterpreted as repo-relative; resolving here keeps a
  // path typed on the command line meaning "relative to where I typed it".
  const resolvedPlanMdPaths = planMdPaths.map((p) => resolve(process.cwd(), p));

  const model = config.extractPlanModel;
  const effort = config.extractPlanEffort;
  const { stateRoot } = config;
  const nowIso = new Date().toISOString();
  const noExtract = opts.noExtract ?? false;
  const loaderOpts = { model, effort, stateRoot, noExtract, nowIso };

  if (opts.landed !== undefined) {
    const shortNameResult = decodeShortName(opts.landed);
    if (Either.isLeft(shortNameResult)) {
      out.error(`Invalid run name "${opts.landed}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
      return 1;
    }
    const infoResult = resolveRun(config.namespace, shortNameResult.right, stateRoot);
    if (Either.isLeft(infoResult)) {
      out.error(`Could not resolve run "${opts.landed}": ${infoResult.left}`);
      return 1;
    }
    const { runPath } = infoResult.right;

    const impactResult = await Effect.runPromise(
      analyzeReadjustmentImpact(runPath, resolvedPlanMdPaths, loaderOpts).pipe(
        Effect.either,
        Effect.provide(nodeLayer(config)),
      ),
    );

    if (Either.isLeft(impactResult)) {
      out.error(impactResult.left.message);
      return 1;
    }

    if (opts.json === true) {
      out.log(JSON.stringify(impactToJson(impactResult.right), null, 2));
    } else {
      out.log(renderReadjustmentImpact(impactResult.right));
    }

    return 0;
  }

  const result = await Effect.runPromise(
    analyzePlanOverlap(resolvedPlanMdPaths, loaderOpts).pipe(
      Effect.either,
      Effect.provide(nodeLayer(config)),
    ),
  );

  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return 1;
  }

  if (opts.json === true) {
    out.log(JSON.stringify(resultToJson(result.right), null, 2));
  } else {
    out.log(renderPlanOverlap(result.right));
  }

  return 0;
}
