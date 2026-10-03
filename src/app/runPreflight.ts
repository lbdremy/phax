/**
 * The shared run preflight set: every preflight that does not need the run's
 * own state (its folder, registry entry or branch).
 *
 * executePlan's preflight block is exactly this set — it is the resume
 * re-check, so the inputs that can change between two invocations are checked
 * again before any branch, worktree or agent work. `phax run` runs the same
 * set before it names the run, so a refusal leaves nothing behind.
 *
 * A check that needs the run's folder, registry entry or branch must be
 * declared outside this set, explicitly.
 */
import { Effect } from "effect";
import {
  type ConfigValidationError,
  ModelPreflightError,
  RecordsSyncRequiredError,
  SecurityPreflightError,
  type SkillEditConsentError,
  UnsafeGitStateError,
} from "../domain/errors.js";
import { preflightPhaseModels } from "../domain/routing/preflight.js";
import {
  applyProviderPriorityOverride,
  type NonEmptyArray,
} from "../domain/routing/priorityOverride.js";
import type { ProviderId } from "../domain/routing/types.js";
import { checkRequiredCommands } from "../domain/security/agentCommands.js";
import type { McpMode } from "../domain/security/types.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { Git, GitError } from "../ports/git.js";
import type { ModelRouting } from "../schemas/modelRouting.js";
import type { GateStep, ResolvedConfig } from "../schemas/phaxConfig.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import type { ProviderConfig } from "../schemas/providerConfig.js";
import { resolveGateProfile } from "./gates.js";
import { loadModelRouting, loadProviderConfig } from "./loadRouting.js";
import { checkRecordsRunPreflight } from "./recordsSync.js";
import { skillEditConsentRefusal } from "./skillEditConsent.js";
import { checkCleanWorkingTree } from "./worktree.js";

export const RUN_PREFLIGHT_CHECKS = [
  "gate-profile",
  "required-commands",
  "skill-edit-consent",
  "mcp-allow",
  "records-destination",
  "phase-models",
] as const;

export type RunPreflightCheck = (typeof RUN_PREFLIGHT_CHECKS)[number];

export interface RunPreflightInput {
  readonly plan: PhaxPlan;
  readonly config: ResolvedConfig;
  readonly gateProfileId: string;
  readonly workspaceId?: string | undefined;
  readonly namespace: string;
  readonly routing: ModelRouting;
  readonly providerConfig: ProviderConfig;
  readonly allowSkillEdits: boolean;
  /** Index of the first phase still to run; skill edit consent covers only those. */
  readonly startIndex: number;
}

export type RunPreflightRefusal =
  | UnsafeGitStateError
  | SecurityPreflightError
  | SkillEditConsentError
  | RecordsSyncRequiredError
  | ModelPreflightError;

export type RunPreflightError = RunPreflightRefusal | FsError;

export function mcpAllowlistPreflight(mcp: {
  readonly mode: McpMode;
  readonly allow: readonly string[];
}): Effect.Effect<void, SecurityPreflightError, FileSystem> {
  if (mcp.mode !== "allowlist") return Effect.void;
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const missing: string[] = [];
    for (const entry of mcp.allow) {
      const ok = yield* fs.exists(entry).pipe(Effect.orElse(() => Effect.succeed(false)));
      if (!ok) missing.push(entry);
    }
    if (missing.length > 0) {
      return yield* Effect.fail(
        new SecurityPreflightError({
          message: [
            `Security preflight failed: ${missing.length} mcp.allow ${missing.length === 1 ? "entry does" : "entries do"} not resolve to a readable file.`,
            `Missing: ${missing.map((e) => `"${e}"`).join(", ")}`,
            `mcp.allow entries must be paths to MCP server config files (not server names).`,
          ].join("\n"),
          missing,
        }),
      );
    }
  });
}

function resolveGateSteps(
  input: RunPreflightInput,
): Effect.Effect<readonly GateStep[], UnsafeGitStateError> {
  const { config, gateProfileId, workspaceId } = input;
  return Effect.try({
    try: () => resolveGateProfile(config, gateProfileId, workspaceId),
    catch: (err) =>
      new UnsafeGitStateError({
        message: err instanceof Error ? err.message : String(err),
        repoPath: config.repoRoot,
      }),
  });
}

const checks = {
  "gate-profile": (input) => Effect.asVoid(resolveGateSteps(input)),

  // Verify all plan-required commands are covered by the frozen set before any
  // git branch, worktree, or agent work begins.
  "required-commands": (input) =>
    Effect.gen(function* () {
      const gateSteps = yield* resolveGateSteps(input);
      const preflightResult = checkRequiredCommands({
        requiredCommands: input.plan.run.requiredCommands,
        configCommands: input.config.security.agentCommands,
        gateCommands: gateSteps.map((s) => s.command),
      });
      if (preflightResult.missing.length > 0) {
        return yield* Effect.fail(
          new SecurityPreflightError({
            message: [
              `Security preflight failed: the plan requires ${preflightResult.missing.length} command(s) not covered by the frozen set.`,
              `Missing: ${preflightResult.missing.map((c) => `"${c}"`).join(", ")}`,
              `Add the missing commands to security.agentCommands in phax.json before running.`,
            ].join("\n"),
            missing: preflightResult.missing,
          }),
        );
      }
    }),

  // Phases still to run that declare `.claude/skills/**` files need skill edit
  // consent. Runs on resume too, so a run with no recorded consent is refused
  // instead of having its skill edits silently denied.
  "skill-edit-consent": (input) => {
    const refusal = skillEditConsentRefusal(
      input.plan.phases.slice(input.startIndex),
      input.allowSkillEdits,
    );
    return refusal === undefined ? Effect.void : Effect.fail(refusal);
  },

  // Verify all mcp.allow entries resolve to readable files.
  "mcp-allow": (input) => mcpAllowlistPreflight(input.config.security.mcp),

  // A dedicated records destination with no local clone yet refuses the run
  // before any phase spawns (spec §5.7) — phax never clones on its own here,
  // so this only checks and names `phax records sync`.
  "records-destination": (input) =>
    Effect.gen(function* () {
      const recordsPreflight = yield* checkRecordsRunPreflight({
        records: input.config.records,
        stateRoot: input.config.stateRoot,
        namespace: input.namespace,
      });
      if (recordsPreflight.kind === "refused") {
        return yield* Effect.fail(
          new RecordsSyncRequiredError({
            message: recordsPreflight.message,
            path: recordsPreflight.path,
            remote: recordsPreflight.remote,
          }),
        );
      }
    }),

  // Validate every phase's model and effort against the catalog — all phases,
  // not only those still to run.
  "phase-models": (input) => {
    const modelPreflight = preflightPhaseModels(
      input.plan.phases,
      input.routing,
      input.providerConfig,
    );
    if (modelPreflight.failures.length === 0) return Effect.void;
    const lines: string[] = [
      `Model preflight failed: ${modelPreflight.failures.length} phase(s) have invalid model configuration.`,
    ];
    for (const failure of modelPreflight.failures) {
      lines.push(`\n  ${failure.phaseId} (${failure.model}/${failure.effort}):`);
      for (const reason of failure.reasons) {
        lines.push(`    - ${reason}`);
      }
      if (failure.alternatives.length > 0) {
        lines.push(`    Alternatives:`);
        for (const alt of failure.alternatives) {
          lines.push(`      ${alt.id} (${alt.family}): ${alt.efforts.join(", ")}`);
        }
      }
    }
    return Effect.fail(
      new ModelPreflightError({
        message: lines.join("\n"),
        failures: modelPreflight.failures.map((f) => ({
          phaseId: f.phaseId,
          model: f.model,
          effort: f.effort,
          reasons: f.reasons,
          alternatives: f.alternatives.map((a) => ({
            id: a.id,
            family: a.family,
            efforts: a.efforts,
          })),
        })),
      }),
    );
  },
} satisfies Record<
  RunPreflightCheck,
  (input: RunPreflightInput) => Effect.Effect<void, RunPreflightError, FileSystem>
>;

/**
 * Run every check in RUN_PREFLIGHT_CHECKS order, stopping at the first refusal.
 * Reads only through the FileSystem port and writes nothing. On success yields
 * the resolved gate steps.
 */
export function runPreflights(
  input: RunPreflightInput,
): Effect.Effect<{ readonly gateSteps: readonly GateStep[] }, RunPreflightError, FileSystem> {
  return Effect.gen(function* () {
    for (const id of RUN_PREFLIGHT_CHECKS) {
      yield* checks[id](input);
    }
    const gateSteps = yield* resolveGateSteps(input);
    return { gateSteps };
  });
}

/**
 * Every step `phax run` takes before it names a fresh run: the routing config
 * load, the shared set and the read-only clean-tree check. Phase 3's guard
 * table is keyed by this type.
 */
export type FreshRunPreflightStep = "routing-config" | RunPreflightCheck | "clean-tree";

export interface FreshRunPreflightInput {
  readonly plan: PhaxPlan;
  readonly config: ResolvedConfig;
  readonly gateProfileId: string;
  readonly namespace: string;
  readonly allowSkillEdits: boolean;
  readonly allowDirty: boolean;
  readonly priorityOverride?: NonEmptyArray<ProviderId> | undefined;
}

/**
 * Clear a fresh `phax run` to be named, or fail with its first refusal. The
 * order reproduces today's first refusal: skill edit consent, the routing
 * config load, the shared run preflight set, then the clean-tree check. Writes
 * nothing. On success yields the (overridden) routing and provider config that
 * executePlan needs.
 */
export function freshRunPreflight(
  input: FreshRunPreflightInput,
): Effect.Effect<
  { readonly routing: ModelRouting; readonly providerConfig: ProviderConfig },
  RunPreflightError | ConfigValidationError | GitError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const refusal = skillEditConsentRefusal(input.plan.phases, input.allowSkillEdits);
    if (refusal !== undefined) return yield* Effect.fail(refusal);

    const loaded = yield* Effect.all({
      routing: loadModelRouting(),
      providerConfig: loadProviderConfig(),
    });
    const routing =
      input.priorityOverride === undefined
        ? loaded.routing
        : applyProviderPriorityOverride(loaded.routing, input.priorityOverride);
    const { providerConfig } = loaded;

    yield* runPreflights({
      plan: input.plan,
      config: input.config,
      gateProfileId: input.gateProfileId,
      namespace: input.namespace,
      routing,
      providerConfig,
      allowSkillEdits: input.allowSkillEdits,
      startIndex: 0,
    });

    yield* checkCleanWorkingTree(input.config.repoRoot, input.allowDirty);

    return { routing, providerConfig };
  });
}
