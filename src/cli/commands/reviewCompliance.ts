import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { reviewComplianceAndRecord } from "../../app/reviewCompliance.js";
import {
  reviewEntryNotice,
  reviewEntryWarnings,
  reviewRecordTargetFor,
} from "../../app/reviewEntry.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import type { Git } from "../../ports/git.js";
import type { GitHub } from "../../ports/github.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import { sessionFailureError } from "../../domain/session/failureError.js";
import {
  exitCodeForError,
  makeProviderBackendLayer,
  makeRepoRootedFileSystemLayer,
} from "./runLayers.js";
import { isSessionFailureError, renderSessionFailure } from "./sessionFailureOutput.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import type { FileSystem } from "../../ports/fs.js";
import type { Backend } from "../../ports/backend.js";
import type { SystemTelemetry } from "../../ports/systemTelemetry.js";

export interface ReviewComplianceCommandOptions {
  verbose?: boolean;
}

export async function runReviewCompliance(
  shortNameArg: string,
  opts: ReviewComplianceCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;

  if (!config.complianceReview.enabled) {
    out.error(
      `review.compliance is not enabled in phax.json. ` +
        `Add a "review": { "compliance": { "enabled": true } } block to phax.json to use this command.`,
    );
    return 1;
  }

  const stateRoot = effectiveStateRoot(config);
  const resolveResult = resolveRunRef(shortNameArg, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, info, crossProject } = resolveResult.right;
  if (crossProject) {
    out.log(`Target: ${runKey(namespace, shortName)}`);
  }

  if (info.runState !== "review_open") {
    out.error(
      `Run "${shortName}" is in state "${info.runState}", not "review_open". ` +
        `The review-compliance command only operates on runs in review_open state.`,
    );
    return 1;
  }

  const routingResult = await Effect.runPromise(
    Effect.either(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }),
    ).pipe(Effect.provide(makeRepoRootedFileSystemLayer(config))),
  );
  if (Either.isLeft(routingResult)) {
    out.error(`Failed to load routing config: ${routingResult.left.message}`);
    return 1;
  }
  const { routing, providerConfig } = routingResult.right;

  const resolution = resolveModel(
    { model: config.complianceReview.model, effort: config.complianceReview.effort },
    routing,
    providerConfig,
    () => ({ allowed: true }),
  );

  function buildLayer(): Layer.Layer<Backend | FileSystem | SystemTelemetry | Git | GitHub> {
    return Layer.mergeAll(
      makeProviderBackendLayer(providerConfig),
      makeRepoRootedFileSystemLayer(config),
      NoopSystemTelemetryLayer,
      NodeGitLayer,
      NodeGitHubLayer,
    );
  }

  const effect = reviewComplianceAndRecord(
    info,
    config.complianceReview,
    resolution,
    { mode: config.security.profile, config: config.security },
    reviewRecordTargetFor({ config, namespace, info, crossProject }),
    opts.verbose !== undefined ? { verbose: opts.verbose } : {},
  ).pipe(Effect.provide(buildLayer()));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Unexpected error during compliance review: ${result.left.message}`);
    return 1;
  }

  const outcome = result.right;
  const review = outcome.review;

  if (review.kind === "disabled") {
    out.error(
      `review.compliance is not enabled in phax.json. ` +
        `Add a "review": { "compliance": { "enabled": true } } block to phax.json to use this command.`,
    );
    return 1;
  }

  if (review.kind === "failed") {
    if (review.sessionFailure != null) {
      const err = sessionFailureError(
        review.sessionFailure,
        review.sessionFailureFiles ?? { agentErrorLog: null, transcript: null },
      );
      if (isSessionFailureError(err)) {
        for (const line of renderSessionFailure(err, `phax review-compliance ${shortName}`)) {
          out.error(line);
        }
        return review.sessionFailure.kind === "network" ? exitCodeForError(err) : 1;
      }
    }
    out.error(
      `Compliance review failed: ${review.failureReason ?? "unknown error"}. ` +
        `To retry, run: phax review-compliance ${shortName}`,
    );
    return 1;
  }

  // generated
  const verdict =
    review.structuredVerdictMissing === true ? "unknown" : (review.verdict ?? "unknown");
  out.log(`Verdict: ${verdict}`);
  if (review.mdArtifactPath !== undefined) {
    out.log(`Compliance review: ${review.mdArtifactPath}`);
  }
  const notice = reviewEntryNotice(outcome);
  if (notice !== undefined) out.log(notice);
  const retryRef = crossProject ? runKey(namespace, shortName) : shortName;
  for (const warning of reviewEntryWarnings(
    outcome,
    "compliance-review",
    `phax review-compliance ${retryRef}`,
  )) {
    out.warn(warning);
  }
  return 0;
}
