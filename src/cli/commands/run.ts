import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName, type ShortName } from "../../domain/branded.js";
import { runKey } from "../../domain/runRef.js";
import { decodeRegistry } from "../../schemas/registry.js";
import {
  GateAttemptsExhaustedError,
  PhaseHadNoChangesError,
  RateLimitError,
  UsageLimitError,
} from "../../domain/errors.js";
import { buildWhatsNext, renderWhatsNext, toKeepAwakePlatform } from "../../domain/whatsNext.js";
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
import type { SecurityMode } from "../../domain/security/types.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { setRunInterruptContext, clearRunInterruptContext } from "../interruptHandler.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import type { PhaxPlan } from "../../schemas/phaxPlan.js";
import { buildSystemTelemetryLayer, exitCodeForError, provideRunLayers } from "./runLayers.js";
import { reportConfigError } from "./reportConfigError.js";
import { loadTelemetryConfig } from "../../app/loadTelemetryConfig.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";

export interface RunCommandOptions {
  shortName?: string;
  planMd?: string;
  dryRun?: boolean;
  profile?: string;
  workspace?: string;
  allowDirty?: boolean;
  providerPriority?: string;
  security?: string;
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

function readRegistrySync(stateRoot: string) {
  try {
    const raw = JSON.parse(readFileSync(join(stateRoot, "registry.json"), "utf8")) as unknown;
    const decoded = decodeRegistry(raw);
    return Either.isRight(decoded) ? decoded.right : { version: 1 as const, runs: [] };
  } catch {
    return { version: 1 as const, runs: [] };
  }
}

// Collision detection is scoped to the namespace via the registry (covering
// archived runs) and additionally guards against any existing bare folder.
function ensureUniqueShortName(stateRoot: string, namespace: string, base: ShortName): ShortName {
  const registry = readRegistrySync(stateRoot);
  const runsDir = join(stateRoot, "runs");

  const nameUsed = (name: string): boolean =>
    registry.runs.some((r) => r.namespace === namespace && r.shortName === name) ||
    existsSync(join(runsDir, name));

  if (!nameUsed(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const trimmed = base.slice(0, 64 - suffix.length).replace(/-+$/g, "");
    const candidate = `${trimmed}${suffix}` as ShortName;
    if (!nameUsed(candidate)) return candidate;
  }
}

const VALID_SECURITY_MODES: SecurityMode[] = ["secure", "unsafe", "isolated"];

function resolveSecurityMode(
  flagMode: string | undefined,
  configMode: SecurityMode,
): SecurityMode | null {
  if (flagMode !== undefined) {
    // Validate the flag value
    if (VALID_SECURITY_MODES.includes(flagMode as SecurityMode)) {
      return flagMode as SecurityMode;
    }
    return null;
  }
  return configMode;
}

function printUnsafeWarning(out: OutputPort): void {
  const warning = [
    "",
    "┌─────────────────────────────────────────────────────────────┐",
    "│  ⚠️  UNSAFE MODE — HOST UNRESTRICTED                               │",
    "│                                                                 │",
    "│  Running in unsafe mode grants the agent full host access:     │",
    "│    • Full filesystem read/write (including ~/.ssh, /etc)       │",
    "│    • Unrestricted network access                               │",
    "│    • MCP servers can connect to any endpoint                  │",
    "│    • Shell commands run with full user permissions             │",
    "│                                                                 │",
    "│  THIS IS NOT RECOMMENDED for untrusted prompts or code.        │",
    "│  Use --security secure (the default) for provider-native      │",
    "│  sandboxing, or wait for the future external-sandbox mode.     │",
    "│                                                                 │",
    "│  Set security.profile in phax.json to change the default.       │",
    "└─────────────────────────────────────────────────────────────┘",
    "",
  ].join("\n");
  out.warn(warning);
}

export async function runRun(opts: RunCommandOptions, out: OutputPort): Promise<number> {
  const cwd = process.cwd();
  const planMdPath = resolve(cwd, opts.planMd ?? "plan.md");

  const configResult = loadConfig(cwd);
  if (Either.isLeft(configResult)) {
    reportConfigError(configResult.left, out);
    return 2;
  }
  const config = configResult.right;

  const telemetryConfigResult = loadTelemetryConfig();
  if (Either.isLeft(telemetryConfigResult)) {
    reportConfigError(telemetryConfigResult.left, out);
    return 2;
  }
  const telemetryEnabled = telemetryConfigResult.right.enabled;

  // Resolve effective security mode: CLI flag overrides config
  const effectiveSecurityMode = resolveSecurityMode(opts.security, config.security.profile);
  if (effectiveSecurityMode === null) {
    out.error(`Invalid security mode "${opts.security}". Must be one of: secure, unsafe, isolated`);
    return 2;
  }

  // Handle isolated mode (stub - not yet available)
  if (effectiveSecurityMode === "isolated") {
    out.error(
      "External sandbox mode is planned but not available yet. Use 'secure' for provider-native restrictions or 'unsafe' for host-unrestricted execution.",
    );
    return 2;
  }

  // Print unsafe warning
  if (effectiveSecurityMode === "unsafe") {
    printUnsafeWarning(out);
  }

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
  });

  // We don't yet know the shortName (it comes out of extraction), so use a
  // placeholder telemetry layer for the extract step, then rebuild under the
  // real run folder for execute.
  const extractTelemetryLayer = telemetryEnabled
    ? buildSystemTelemetryLayer(
        opts,
        join(config.stateRoot, "extract-semantic.jsonl"),
        out,
        "extract-plan" as unknown as import("../../domain/branded.js").RunId,
      )
    : NoopSystemTelemetryLayer;

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

  if (opts.dryRun) {
    out.log(
      formatDryRunReport(
        buildDryRunReport(
          plan,
          config,
          opts.profile,
          priorityOverride !== undefined ? [...priorityOverride] : undefined,
          effectiveSecurityMode,
        ),
      ),
    );
    return 0;
  }

  const namespace = config.namespace;

  // The slug may already name an existing run (in this namespace); bump it so
  // we never clobber a prior run. Uniqueness is scoped to the namespace via the
  // registry (covering archived runs), plus a bare-folder check for the interim.
  const shortName = ensureUniqueShortName(config.stateRoot, namespace, shortNameResult.right);
  const runPlan: PhaxPlan =
    shortName === shortNameResult.right
      ? plan
      : { ...plan, run: { ...plan.run, shortName, branch: `phax/${shortName}` } };
  if (shortName !== shortNameResult.right) {
    out.warn(
      `Run "${runKey(namespace, shortNameResult.right)}" already exists; using "${runKey(namespace, shortName)}" instead.`,
    );
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
  const telemetryLayer = telemetryEnabled
    ? buildSystemTelemetryLayer(
        opts,
        semanticJsonlPath,
        out,
        shortName as unknown as import("../../domain/branded.js").RunId,
      )
    : NoopSystemTelemetryLayer;

  setRunInterruptContext(shortName, config.stateRoot);
  try {
    const program = withRunLock(
      shortName,
      createRunFolder(shortName, planMd, runPlan, config).pipe(
        Effect.flatMap(({ runPath, runId }) =>
          executePlan({
            shortName,
            plan: runPlan,
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
            securityMode: effectiveSecurityMode,
            verbose: opts.verbose,
          }),
        ),
      ),
    );

    const result = await Effect.runPromise(
      Effect.either(provideRunLayers(program, config, telemetryLayer, providerConfig)),
    );

    if (Either.isLeft(result)) {
      const err = result.left;
      const qualName = runKey(namespace, shortName);
      if (err instanceof RateLimitError || err instanceof UsageLimitError) {
        out.warn(`Run "${qualName}" paused: ${err.message}`);
        out.warn(
          renderWhatsNext(
            buildWhatsNext(
              {
                kind: "limit",
                shortName,
                resetAt: err.resetAt,
                phaseId: err.phaseId,
                platform: toKeepAwakePlatform(process.platform),
              },
              new Date(),
            ),
          ),
        );
        out.warn(`See ${join(runFolder, "resume-instructions.md")} for details.`);
        return exitCodeForError(err);
      }
      if (err instanceof GateAttemptsExhaustedError) {
        out.warn(`Run "${qualName}" gates exhausted: ${err.message}`);
        out.warn(
          renderWhatsNext(
            buildWhatsNext(
              { kind: "gates_exhausted", shortName, phaseId: err.phaseId },
              new Date(),
            ),
          ),
        );
        out.warn(`See ${join(runFolder, "resume-instructions.md")} for details.`);
        return exitCodeForError(err);
      }
      if (err instanceof PhaseHadNoChangesError) {
        out.warn(`Run "${qualName}" paused: phase ${err.phaseId} produced no changes.`);
        out.warn(
          renderWhatsNext(
            buildWhatsNext(
              { kind: "phase_no_changes", shortName, phaseId: err.phaseId },
              new Date(),
            ),
          ),
        );
        out.warn(`See ${join(runFolder, "resume-instructions.md")} for details.`);
        return exitCodeForError(err);
      }
      out.error(`phax run failed: ${err instanceof Error ? err.message : String(err)}`);
      return exitCodeForError(err);
    }

    out.warn(renderWhatsNext(buildWhatsNext({ kind: "review_open", shortName }, new Date())));
    return 0;
  } finally {
    clearRunInterruptContext();
  }
}
