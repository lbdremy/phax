import { Effect, Either, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { readAgentBinding } from "../../app/agentBinding.js";
import { prepareAdjustPlanSession } from "../../app/adjustPlan.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { Session } from "../../ports/session.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";

const VALID_EFFORT_VALUES = ["low", "medium", "high"] as const;
type ValidEffort = (typeof VALID_EFFORT_VALUES)[number];

function isValidEffort(value: string): value is ValidEffort {
  return (VALID_EFFORT_VALUES as readonly string[]).includes(value);
}

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_EFFORT: ValidEffort = "high";

export interface AdjustPlanCommandOptions {
  readonly landed: string;
  readonly newSession?: boolean;
  readonly model?: string;
  readonly effort?: string;
  readonly verbose?: boolean;
}

export async function runAdjustPlan(
  planPathArg: string,
  opts: AdjustPlanCommandOptions,
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

  const effectiveModel = opts.model ?? DEFAULT_MODEL;
  const effectiveEffort: ValidEffort = opts.effort !== undefined ? opts.effort : DEFAULT_EFFORT;

  const stateRoot = effectiveStateRoot(config);
  const resolveResult = resolveRunRef(opts.landed, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, info, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortName);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  let planMarkdown: string;
  try {
    planMarkdown = await readFile(planPathArg, "utf8");
  } catch {
    out.error(`Cannot read plan.md at "${planPathArg}": file not found or not readable.`);
    return 1;
  }

  const phaseFolderPath = join(info.runPath, info.finalPhaseId);
  const bindingResult = await readAgentBinding(phaseFolderPath);
  if (Either.isLeft(bindingResult)) {
    out.error(`No agent binding found for run "${qualifiedName}": ${bindingResult.left}`);
    return 1;
  }
  const binding = bindingResult.right;

  const nodeLayer = Layer.mergeAll(
    makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG),
    NodeFileSystemLayer,
    NoopSystemTelemetryLayer,
  );

  const prepareEffect = prepareAdjustPlanSession({
    planPath: planPathArg,
    planMarkdown,
    runPath: info.runPath,
    runKey: qualifiedName,
    provider: binding.provider,
    cwd: process.cwd(),
    extract: {
      model: config.extractPlanModel,
      effort: config.extractPlanEffort,
      stateRoot,
    },
    newSession: opts.newSession ?? false,
    nowIso: new Date().toISOString(),
    ...(opts.model !== undefined ? { modelOverride: opts.model } : {}),
    ...(opts.effort !== undefined ? { effortOverride: opts.effort } : {}),
    model: effectiveModel,
    effort: effectiveEffort,
  }).pipe(Effect.provide(nodeLayer));

  const prepareResult = await Effect.runPromise(Effect.either(prepareEffect));
  if (Either.isLeft(prepareResult)) {
    out.error(`Unexpected error during adjust-plan preparation: ${prepareResult.left.message}`);
    return 1;
  }

  const result = prepareResult.right;

  if (result.kind === "unsupported" || result.kind === "refused") {
    out.error(result.message);
    return 1;
  }

  const { invocation, mode } = result;
  if (mode === "new") {
    out.log(`Starting plan adjustment session in ${invocation.cwd}`);
  } else {
    out.log(`Resuming plan adjustment session in ${invocation.cwd}`);
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
