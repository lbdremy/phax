import { join, resolve } from "node:path";
import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { RateLimitError, UsageLimitError } from "../../domain/errors.js";
import { loadConfig } from "../../app/loadConfig.js";
import { buildDryRunReport, formatDryRunReport } from "../../app/dryRun.js";
import { extractPlanCore } from "../../app/extractPlan.js";
import { createRunFolder } from "../../app/runFolder.js";
import { executePlan } from "../../app/executePlan.js";
import { withRunLock } from "../../app/lock.js";
import { loadModelRouting, loadProviderConfig } from "../../app/loadRouting.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../domain/routing/defaults.js";
import {
  parseProviderPriority,
  applyProviderPriorityOverride,
} from "../../domain/routing/priorityOverride.js";
import type { NonEmptyArray } from "../../domain/routing/priorityOverride.js";
import type { ProviderId } from "../../domain/routing/types.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { setRunInterruptContext, clearRunInterruptContext } from "../interruptHandler.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { buildSystemTelemetryLayer, exitCodeForError, provideRunLayers } from "./runLayers.js";

export interface RunCommandOptions {
  shortName?: string;
  planMd?: string;
  dryRun?: boolean;
  profile?: string;
  workspace?: string;
  allowDirty?: boolean;
  providerPriority?: string;
  verbose?: boolean;
  trace?: boolean;
}

function pickGateProfileId(config: ResolvedConfig, profileOpt: string | undefined): string | null {
  const profiles = config.raw.gateProfiles;

  if (profileOpt !== undefined) {
    return profileOpt in profiles ? profileOpt : null;
  }

  if ("full" in profiles) return "full";
  if ("fast" in profiles) return "fast";

  const keys = Object.keys(profiles);
  return keys[0] ?? null;
}

export async function runRun(opts: RunCommandOptions, out: OutputPort): Promise<number> {
  const cwd = process.cwd();
  const planMdPath = resolve(cwd, opts.planMd ?? "plan.md");

  const configResult = loadConfig(cwd);
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 2;
  }
  const config = configResult.right;

  const gateProfileId = pickGateProfileId(config, opts.profile);
  if (gateProfileId === null) {
    if (opts.profile !== undefined) {
      out.error(
        `Gate profile "${opts.profile}" not found in phax.json. Available: ${Object.keys(config.raw.gateProfiles).join(", ")}`,
      );
    } else {
      out.error("No gate profiles configured in phax.json");
    }
    return 2;
  }

  let priorityOverride: NonEmptyArray<ProviderId> | undefined;
  if (opts.providerPriority !== undefined) {
    const parsed = parseProviderPriority(opts.providerPriority);
    if (!parsed.ok) {
      out.error(parsed.error);
      return 2;
    }
    priorityOverride = parsed.value;
  }

  // Extract plan.md → PhaxPlan via Claude. The result is never persisted in
  // the user's repo — `createRunFolder` snapshots it under ~/.phax/runs/.
  const extractEffect = extractPlanCore({
    planMdPath,
    model: config.extractPlanModel,
    effort: config.extractPlanEffort,
    cwd,
    backend: config.backend,
  });

  // We don't yet know the shortName (it comes out of extraction), so use a
  // placeholder telemetry layer for the extract step, then rebuild under the
  // real run folder for execute.
  const extractTelemetryLayer = buildSystemTelemetryLayer(
    opts,
    join(config.stateRoot, "extract-semantic.jsonl"),
    out,
    "extract-plan" as unknown as import("../../domain/branded.js").RunId,
  );

  const extracted = await Effect.runPromise(
    Effect.either(
      provideRunLayers(extractEffect, config, extractTelemetryLayer, DEFAULT_PROVIDER_CONFIG),
    ),
  );

  if (Either.isLeft(extracted)) {
    const err = extracted.left;
    if (err instanceof RateLimitError || err instanceof UsageLimitError) {
      out.error(`Plan extraction paused: ${err.message}`);
      return exitCodeForError(err);
    }
    out.error(`Plan extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return exitCodeForError(err);
  }

  const { plan, planMd, warnings } = extracted.right;
  for (const w of warnings) {
    out.warn(`extract warning: ${w}`);
  }

  if (opts.shortName !== undefined && opts.shortName !== plan.run.shortName) {
    out.error(
      `Short name mismatch: argument "${opts.shortName}" does not match plan short name "${plan.run.shortName}"`,
    );
    return 2;
  }

  const shortNameResult = decodeShortName(plan.run.shortName);
  if (Either.isLeft(shortNameResult)) {
    out.error(
      `Invalid short name "${plan.run.shortName}" in plan: must match ^[a-z][a-z0-9-]*$ (1–64 chars)`,
    );
    return 2;
  }
  const shortName = shortNameResult.right;

  if (opts.dryRun) {
    out.log(
      formatDryRunReport(
        buildDryRunReport(
          plan,
          config,
          opts.profile,
          priorityOverride !== undefined ? [...priorityOverride] : undefined,
        ),
      ),
    );
    return 0;
  }

  const routingResult = await Effect.runPromise(
    Effect.either(
      Effect.all({ routing: loadModelRouting(), providerConfig: loadProviderConfig() }),
    ).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  if (Either.isLeft(routingResult)) {
    out.error(`Failed to load routing config: ${routingResult.left.message}`);
    return 2;
  }
  let { routing } = routingResult.right;
  const { providerConfig } = routingResult.right;
  if (priorityOverride !== undefined) {
    routing = applyProviderPriorityOverride(routing, priorityOverride);
  }

  const runFolder = join(config.stateRoot, "runs", shortName);
  const semanticJsonlPath = join(runFolder, "semantic.jsonl");
  const telemetryLayer = buildSystemTelemetryLayer(
    opts,
    semanticJsonlPath,
    out,
    shortName as unknown as import("../../domain/branded.js").RunId,
  );

  setRunInterruptContext(shortName, config.stateRoot);
  try {
    const program = withRunLock(
      shortName,
      createRunFolder(shortName, planMd, plan, config).pipe(
        Effect.flatMap(({ runPath, runId }) =>
          executePlan({
            shortName,
            plan,
            planMd,
            config,
            gateProfileId,
            workspaceId: opts.workspace,
            allowDirty: opts.allowDirty ?? false,
            runPath,
            runId,
            startIndex: 0,
            routing,
            providerConfig,
          }),
        ),
      ),
    );

    const result = await Effect.runPromise(
      Effect.either(provideRunLayers(program, config, telemetryLayer, providerConfig)),
    );

    if (Either.isLeft(result)) {
      const err = result.left;
      if (err instanceof RateLimitError || err instanceof UsageLimitError) {
        out.warn(`Run "${shortName}" paused: ${err.message}`);
        out.log(
          `See ${join(runFolder, "resume-instructions.md")} — resume with \`phax resume ${shortName} --yes\` once the limit clears.`,
        );
        return exitCodeForError(err);
      }
      out.error(`phax run failed: ${err instanceof Error ? err.message : String(err)}`);
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
