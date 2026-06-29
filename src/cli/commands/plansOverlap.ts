import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { analyzePlanOverlap } from "../../app/analyzePlanOverlap.js";
import { renderPlanOverlap } from "../../domain/planOverlap/render.js";
import type { PlanOverlapResult, PlanFootprint } from "../../domain/planOverlap/types.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
export interface PlansOverlapCommandOptions {
  readonly json?: true;
  readonly noExtract?: true;
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

  const result = await Effect.runPromise(
    analyzePlanOverlap(planMdPaths, { model, effort, stateRoot, noExtract, nowIso }).pipe(
      Effect.either,
      Effect.provide(nodeLayer()),
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
