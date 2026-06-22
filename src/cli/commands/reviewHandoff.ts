import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { generateReviewHandoff } from "../../app/reviewHandoff.js";
import { ReviewHandoffArtifactMissingError } from "../../domain/errors.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeGlobalTelemetryJournalLayer } from "../../infra/telemetry/globalJournal.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import {
  loadTelemetryConfig,
  TELEMETRY_CONFIG_PATH,
  PHAX_HOME_DIR,
} from "../../app/loadTelemetryConfig.js";

export interface ReviewHandoffCommandOptions {
  allowPartial?: boolean;
}

function buildLayer(): Layer.Layer<
  import("../../ports/fs.js").FileSystem | import("../../ports/systemTelemetry.js").SystemTelemetry
> {
  const telemetryConfig = loadTelemetryConfig(TELEMETRY_CONFIG_PATH);
  const telemetryEnabled = Either.isRight(telemetryConfig) ? telemetryConfig.right.enabled : true;
  const telemetryLayer = telemetryEnabled
    ? makeGlobalTelemetryJournalLayer(PHAX_HOME_DIR).pipe(Layer.provide(NodeFileSystemLayer))
    : NoopSystemTelemetryLayer;

  return Layer.mergeAll(NodeFileSystemLayer, telemetryLayer);
}

export async function runReviewHandoff(
  shortNameArg: string,
  opts: ReviewHandoffCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const { stateRoot } = config;

  const resolveResult = resolveRunRef(shortNameArg, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, info, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortName);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  if (info.runState !== "review_open") {
    out.error(
      `Run "${qualifiedName}" is in state "${info.runState}", not "review_open". ` +
        `The review-handoff command only operates on runs in review_open state.`,
    );
    return 1;
  }

  const effect = generateReviewHandoff(info, { allowPartial: opts.allowPartial ?? false }).pipe(
    Effect.provide(buildLayer()),
  );

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    const err = result.left;
    if (err instanceof ReviewHandoffArtifactMissingError) {
      out.error(
        `Missing artifacts for phases: ${err.missingPhases.join(", ")}. ` +
          `Use --allow-partial to generate a partial document.`,
      );
    } else {
      out.error(`Review handoff generation failed: ${err.message}`);
    }
    return 1;
  }

  out.log(
    `Review handoff regenerated for run "${qualifiedName}". See ${info.runPath}/review-handoff.md`,
  );
  return 0;
}
