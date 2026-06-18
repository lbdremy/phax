import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeRunId, decodeShortName } from "../../domain/branded.js";
import { PhaseHadNoChangesError, RateLimitError, UsageLimitError } from "../../domain/errors.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";
import { inspectResume } from "../../app/resume.js";
import { decodeRunStatus } from "../../schemas/status.js";
import { executePlan } from "../../app/executePlan.js";
import { withRunLock } from "../../app/lock.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { DEFAULT_PROVIDER_CONFIG, DEFAULT_MODEL_ROUTING } from "../../domain/routing/defaults.js";
import {
  parseProviderPriority,
  applyProviderPriorityOverride,
} from "../../domain/routing/priorityOverride.js";
import type { NonEmptyArray } from "../../domain/routing/priorityOverride.js";
import type { ProviderId } from "../../domain/routing/types.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { setRunInterruptContext, clearRunInterruptContext } from "../interruptHandler.js";
import { buildSystemTelemetryLayer, exitCodeForError, provideRunLayers } from "./runLayers.js";
import { reportConfigError } from "./reportConfigError.js";

export interface ResumeCommandOptions {
  yes?: boolean;
  verbose?: boolean;
  trace?: boolean;
  providerPriority?: string;
}

export async function runResume(
  shortNameArg: string,
  opts: ResumeCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    reportConfigError(configResult.left, out);
    return 1;
  }
  const config = configResult.right;
  const { stateRoot } = config;

  const shortNameResult = decodeShortName(shortNameArg);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name "${shortNameArg}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
    return 1;
  }
  const shortName = shortNameResult.right;

  let priorityOverride: NonEmptyArray<ProviderId> | undefined;
  if (opts.providerPriority !== undefined) {
    const parsed = parseProviderPriority(opts.providerPriority);
    if (!parsed.ok) {
      out.error(parsed.error);
      return 1;
    }
    priorityOverride = parsed.value;
  }

  const decisionResult = inspectResume(shortName, stateRoot);
  if (Either.isLeft(decisionResult)) {
    const refusal = decisionResult.left;
    if (refusal.reason === "review_open") {
      out.warn(refusal.message);
      return 0;
    }
    out.error(refusal.message);
    return 1;
  }

  const decision = decisionResult.right;
  for (const skippedId of decision.skippedPhaseIds) {
    out.log(`  Skipping ${skippedId} (produced no changes).`);
  }
  out.log(
    `Run "${decision.shortName}" (state: ${decision.fromState}) — would resume from phase ${decision.nextPhaseIndex + 1}: ${decision.nextPhaseId}`,
  );

  if (!opts.yes) {
    out.log("Pass --yes to proceed.");
    return 0;
  }

  const runPath = join(stateRoot, "runs", shortName);
  const planPath = join(runPath, "phax-plan.json");
  const planMdPath = join(runPath, "plan.md");

  const planResult = loadPlan(planPath);
  if (Either.isLeft(planResult)) {
    out.error(`Plan error: ${planResult.left.message}`);
    return 2;
  }
  const plan = planResult.right;

  let planMd: string;
  try {
    planMd = readFileSync(planMdPath, "utf8");
  } catch (e) {
    out.error(
      `Cannot read plan.md at "${planMdPath}": ${e instanceof Error ? e.message : String(e)}`,
    );
    return 2;
  }

  let runStatusRaw: unknown;
  try {
    runStatusRaw = JSON.parse(readFileSync(join(runPath, "run-status.json"), "utf8"));
  } catch (e) {
    out.error(`Cannot read run-status.json: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const runStatusResult = decodeRunStatus(runStatusRaw);
  if (Either.isLeft(runStatusResult)) {
    out.error(`Invalid run-status.json: ${String(runStatusResult.left)}`);
    return 2;
  }
  const runStatus = runStatusResult.right;

  const runIdResult = decodeRunId(runStatus.runId);
  if (Either.isLeft(runIdResult)) {
    out.error(`Invalid runId in run-status.json`);
    return 2;
  }
  const runId = runIdResult.right;

  const profiles = config.raw.gateProfiles;
  const gateProfileId =
    runStatus.gateProfileId ??
    ("full" in profiles
      ? "full"
      : "fast" in profiles
        ? "fast"
        : (Object.keys(profiles)[0] ?? null));

  if (gateProfileId === null) {
    out.error("No gate profiles configured in phax.json");
    return 2;
  }

  const routingResult = await Effect.runPromise(
    Effect.either(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }),
    ).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  const { routing: loadedRouting, providerConfig } = Either.isRight(routingResult)
    ? routingResult.right
    : { routing: undefined, providerConfig: DEFAULT_PROVIDER_CONFIG };

  const routing =
    priorityOverride !== undefined
      ? applyProviderPriorityOverride(loadedRouting ?? DEFAULT_MODEL_ROUTING, priorityOverride)
      : loadedRouting;

  const telemetryLayer = buildSystemTelemetryLayer(
    opts,
    join(runPath, "semantic.jsonl"),
    out,
    shortName as unknown as import("../../domain/branded.js").RunId,
  );

  setRunInterruptContext(shortName, stateRoot);
  try {
    const program = withRunLock(
      shortName,
      executePlan({
        shortName,
        plan,
        planMd,
        config,
        gateProfileId,
        workspaceId: undefined,
        allowDirty: true,
        runPath,
        runId,
        startIndex: decision.nextPhaseIndex,
        routing,
        providerConfig,
        verbose: opts.verbose,
      }),
    );

    const result = await Effect.runPromise(
      Effect.either(provideRunLayers(program, config, telemetryLayer, providerConfig)),
    );

    if (Either.isLeft(result)) {
      const err = result.left;
      if (err instanceof RateLimitError || err instanceof UsageLimitError) {
        out.warn(`Run "${shortName}" paused again: ${err.message}`);
        out.log(
          `See ${join(runPath, "resume-instructions.md")} — resume with \`phax resume ${shortName} --yes\` once the limit clears.`,
        );
        return exitCodeForError(err);
      }
      if (err instanceof PhaseHadNoChangesError) {
        out.warn(`Run "${shortName}" paused: phase ${err.phaseId} produced no changes.`);
        out.log(
          `See ${join(runPath, "resume-instructions.md")} — resume with \`phax resume ${shortName} --yes\` to continue with the next phase.`,
        );
        return exitCodeForError(err);
      }
      out.error(`phax resume failed: ${err instanceof Error ? err.message : String(err)}`);
      return exitCodeForError(err);
    }

    out.log(
      `Run "${shortName}" reached review_open. Use \`phax enter ${shortName}\` or \`phax archive ${shortName}\` when done.`,
    );
    return 0;
  } finally {
    clearRunInterruptContext();
  }
}
