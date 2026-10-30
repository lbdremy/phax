import { Effect, Either, Layer } from "effect";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { prepareCodeReviewSession } from "../../app/reviewCode.js";
import { reviewCodeAndRecord } from "../../app/reviewCode.js";
import {
  reviewEntryNotice,
  reviewEntryWarnings,
  reviewRecordTargetFor,
} from "../../app/reviewEntry.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { resolveModel } from "../../domain/routing/resolve.js";
import {
  codeReviewFixHint,
  describeFindingCounts,
} from "../../domain/review/codeReviewFindings.js";
import type { RunReviewInfo } from "../../domain/runReviewInfo.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import type { ResolvedCodeReviewConfig, ResolvedConfig } from "../../schemas/phaxConfig.js";
import { sessionFailureError } from "../../domain/session/failureError.js";
import {
  exitCodeForError,
  makeProviderBackendLayer,
  makeRepoRootedFileSystemLayer,
} from "./runLayers.js";
import { renderSessionFailure } from "./sessionFailureOutput.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { Session } from "../../ports/session.js";
import { FileSystem } from "../../ports/fs.js";
import { PHAX_REVIEW_SKILL } from "../../domain/skills/catalog.js";
import { defaultBundleRoot } from "./skills.js";

const VALID_EFFORT_VALUES = ["low", "medium", "high"] as const;
type ValidEffort = (typeof VALID_EFFORT_VALUES)[number];

function isValidEffort(value: string): value is ValidEffort {
  return (VALID_EFFORT_VALUES as readonly string[]).includes(value);
}

export interface ReviewCodeCommandOptions {
  newSession?: boolean;
  model?: string;
  effort?: string;
  verbose?: boolean;
  headless?: boolean;
}

async function runHeadless(
  input: {
    config: ResolvedConfig;
    effectiveConfig: ResolvedCodeReviewConfig;
    namespace: string;
    shortName: string;
    info: RunReviewInfo;
    crossProject: boolean;
  },
  out: OutputPort,
): Promise<number> {
  const { config, effectiveConfig, namespace, shortName, info, crossProject } = input;
  const retryRef = crossProject ? runKey(namespace, shortName) : shortName;
  const retryCommand = `phax review-code ${retryRef} --headless`;

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
    { model: effectiveConfig.model, effort: effectiveConfig.effort },
    routing,
    providerConfig,
    () => ({ allowed: true }),
  );

  const effect = Effect.gen(function* () {
    const fs = yield* FileSystem;
    const bundledReviewSkill = yield* fs.readText(
      join(defaultBundleRoot(), PHAX_REVIEW_SKILL, "SKILL.md"),
    );
    return yield* reviewCodeAndRecord(
      info,
      effectiveConfig,
      resolution,
      { mode: config.security.profile, config: config.security },
      reviewRecordTargetFor({ config, namespace, info, crossProject }),
      { bundledReviewSkill, nowIso: new Date().toISOString(), output: out },
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        makeProviderBackendLayer(providerConfig),
        makeRepoRootedFileSystemLayer(config),
        NoopSystemTelemetryLayer,
        NodeGitLayer,
        NodeGitHubLayer,
      ),
    ),
  );

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Unexpected error during code review: ${result.left.message}`);
    return 1;
  }
  const outcome = result.right;
  const review = outcome.review;
  if (review.kind === "failed") {
    if (review.sessionFailure != null) {
      const err = sessionFailureError(
        review.sessionFailure,
        review.sessionFailureFiles ?? { agentErrorLog: null, transcript: null },
      );
      for (const line of renderSessionFailure(err, retryCommand)) out.error(line);
      return review.sessionFailure.kind === "network" ? exitCodeForError(err) : 1;
    }
    out.error(`Code review failed: ${review.reason}. To retry, run: ${retryCommand}`);
    return 1;
  }

  out.log(`Code review: ${describeFindingCounts(review.review.findings)}`);
  out.log(`Findings: ${review.reviewPath}`);
  const fixHint = codeReviewFixHint(review.review.findings.length, review.session, retryRef);
  if (fixHint !== undefined) out.log(fixHint);
  const notice = reviewEntryNotice(outcome);
  if (notice !== undefined) out.log(notice);
  for (const warning of reviewEntryWarnings(outcome, "code-review", retryCommand)) {
    out.warn(warning);
  }
  return 0;
}

export async function runReviewCode(
  shortNameArg: string,
  opts: ReviewCodeCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;

  if (opts.effort !== undefined && !isValidEffort(opts.effort)) {
    out.error(
      `Invalid --effort value "${opts.effort}". Allowed values: ${VALID_EFFORT_VALUES.join(" | ")}`,
    );
    return 1;
  }

  const effectiveModel = opts.model ?? config.codeReview.model;
  const effectiveEffort: ValidEffort =
    opts.effort !== undefined ? opts.effort : config.codeReview.effort;

  const effectiveConfig: ResolvedCodeReviewConfig = {
    enabled: config.codeReview.enabled,
    model: effectiveModel,
    effort: effectiveEffort,
  };

  const stateRoot = effectiveStateRoot(config);
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
      `Run "${shortName}" is in state "${info.runState}", not "review_open". ` +
        `The review-code command only operates on runs in review_open state.`,
    );
    return 1;
  }

  if (opts.headless === true) {
    return runHeadless({ config, effectiveConfig, namespace, shortName, info, crossProject }, out);
  }

  const prepareEffect = Effect.gen(function* () {
    const fs = yield* FileSystem;
    const bundledReviewSkill = yield* fs.readText(
      join(defaultBundleRoot(), PHAX_REVIEW_SKILL, "SKILL.md"),
    );
    return yield* prepareCodeReviewSession(info, effectiveConfig, {
      newSession: opts.newSession ?? false,
      nowIso: new Date().toISOString(),
      ...(opts.model !== undefined ? { modelOverride: opts.model } : {}),
      ...(opts.effort !== undefined ? { effortOverride: opts.effort } : {}),
      bundledReviewSkill,
    });
  }).pipe(
    Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NoopSystemTelemetryLayer)),
  );

  const prepareResult = await Effect.runPromise(Effect.either(prepareEffect));
  if (Either.isLeft(prepareResult)) {
    out.error(`Unexpected error during review-code preparation: ${prepareResult.left.message}`);
    return 1;
  }

  const result = prepareResult.right;

  if (result.kind === "unsupported" || result.kind === "refused") {
    out.error(result.message);
    return 1;
  }

  const { invocation, mode } = result;
  if (mode === "new") {
    out.log(`Starting code review session in ${invocation.cwd}`);
  } else {
    out.log(`Resuming code review session in ${invocation.cwd}`);
  }

  const sessionEffect = Effect.gen(function* () {
    const s = yield* Session;
    return yield* s.resume({ ...invocation, env: {} });
  }).pipe(Effect.provide(makeNodeSessionLayer()));

  const sessionResult = await Effect.runPromise(Effect.either(sessionEffect));
  if (Either.isLeft(sessionResult)) {
    out.error(`Failed to launch ${invocation.executable}: ${sessionResult.left.message}`);
    return 1;
  }
  return sessionResult.right;
}
