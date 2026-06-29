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
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import { decodeShortName } from "../../domain/branded.js";
import { resolveRun } from "../../app/resolveRunInfo.js";

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

function nodeLayer() {
  return Layer.mergeAll(
    makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG),
    NodeFileSystemLayer,
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
      analyzeReadjustmentImpact(runPath, planMdPaths, loaderOpts).pipe(
        Effect.either,
        Effect.provide(nodeLayer()),
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
    analyzePlanOverlap(planMdPaths, loaderOpts).pipe(Effect.either, Effect.provide(nodeLayer())),
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
