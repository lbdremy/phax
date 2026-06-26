import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { prepareCodeReviewSession } from "../../app/reviewCode.js";
import type { ResolvedCodeReviewConfig } from "../../schemas/phaxConfig.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { Session } from "../../ports/session.js";

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

  const prepareEffect = prepareCodeReviewSession(info, effectiveConfig, {
    newSession: opts.newSession ?? false,
    nowIso: new Date().toISOString(),
    ...(opts.model !== undefined ? { modelOverride: opts.model } : {}),
    ...(opts.effort !== undefined ? { effortOverride: opts.effort } : {}),
  }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystemLayer, NoopSystemTelemetryLayer)));

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
    return yield* s.resume(invocation);
  }).pipe(Effect.provide(makeNodeSessionLayer()));

  const sessionResult = await Effect.runPromise(Effect.either(sessionEffect));
  if (Either.isLeft(sessionResult)) {
    out.error(`Failed to launch ${invocation.executable}: ${sessionResult.left.message}`);
    return 1;
  }
  return sessionResult.right;
}
