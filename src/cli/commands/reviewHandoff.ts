import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunByShortName } from "../../app/resolveRunInfo.js";
import { generateReviewHandoff } from "../../app/reviewHandoff.js";
import { ReviewHandoffArtifactMissingError } from "../../domain/errors.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";

export interface ReviewHandoffCommandOptions {
  allowPartial?: boolean;
}

function buildLayer(): Layer.Layer<
  import("../../ports/fs.js").FileSystem | import("../../ports/systemTelemetry.js").SystemTelemetry
> {
  return Layer.mergeAll(NodeFileSystemLayer, NoopSystemTelemetryLayer);
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
  const { stateRoot } = configResult.right;

  const shortNameResult = decodeShortName(shortNameArg);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name "${shortNameArg}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
    return 1;
  }
  const shortName = shortNameResult.right;

  const infoResult = resolveRunByShortName(shortName, stateRoot);
  if (Either.isLeft(infoResult)) {
    out.error(`Could not resolve run "${shortName}": ${infoResult.left}`);
    return 1;
  }
  const info = infoResult.right;

  if (info.runState !== "review_open") {
    out.error(
      `Run "${shortName}" is in state "${info.runState}", not "review_open". ` +
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
    `Review handoff regenerated for run "${shortName}". See ${info.runPath}/review-handoff.md`,
  );
  return 0;
}
