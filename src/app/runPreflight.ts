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
import { Effect, Either } from "effect";
import {
  type ConfigValidationError,
  InteractivePreflightError,
  ModelPreflightError,
  OraclePreflightError,
  PlanSectionsPreflightError,
  RecordsSyncRequiredError,
  SecurityPreflightError,
  type SkillEditConsentError,
  UnsafeGitStateError,
} from "../domain/errors.js";
import { interactiveFindings } from "../domain/plan/interactiveCheck.js";
import { reasonLabelFindings, type LintFinding } from "../domain/plan/lint.js";
import { oracleFindings } from "../domain/plan/oracleCheck.js";
import { readPhaseHeaders, type PhaseHeader } from "../domain/plan/phaseHeader.js";
import { locatePlanSections, type PlanSections } from "../domain/plan/sections.js";
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
  "phase-sections",
  "interactive-phases",
  "oracle-phases",
] as const;

export type RunPreflightCheck = (typeof RUN_PREFLIGHT_CHECKS)[number];

export interface RunPreflightInput {
  readonly plan: PhaxPlan;
  /** The plan.md the phases are located in. */
  readonly planMd: string;
  /** The path a phase-sections refusal tells the operator to lint. */
  readonly planPath: string;
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
  | ModelPreflightError
  | PlanSectionsPreflightError
  | InteractivePreflightError
  | OraclePreflightError;

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

type GateSteps = Effect.Effect<readonly GateStep[], UnsafeGitStateError>;

type LocatedSections = Effect.Effect<PlanSections, PlanSectionsPreflightError>;

function planSectionsRefusal(
  phases: readonly string[],
  planPath: string,
): PlanSectionsPreflightError {
  const [first] = phases;
  const missing =
    phases.length === 1
      ? `${first} has no section in plan.md (expected a "## ${first} — …" heading)`
      : `${phases.join(", ")} have no section in plan.md (expected a "## phase-NN — …" heading for each)`;
  return new PlanSectionsPreflightError({
    message: [
      `Plan preflight failed: ${missing}.`,
      `Fix the plan, then check it with \`phax plans lint ${planPath}\`.`,
    ].join("\n"),
    phases,
    planPath,
  });
}

function declarationRefusalMessage(
  kind: "Interactive" | "Oracle",
  findings: readonly LintFinding[],
  planPath: string,
): string {
  return [
    `${kind} preflight failed: ${findings.length} error(s).`,
    ...findings.map((f) => `  ${f.phase ?? "-"}  ${f.message}`),
    `Fix the plan, then check it with \`phax plans lint ${planPath}\`.`,
  ].join("\n");
}

type ModelFailure = ReturnType<typeof preflightPhaseModels>["failures"][number];

// Merge each label finding into its phase's catalog failure, or add one with
// the phase's model and effort from the plan and no alternatives.
function withLabelFailures(
  failures: readonly ModelFailure[],
  plan: PhaxPlan,
  headers: readonly PhaseHeader[],
): readonly ModelFailure[] {
  const merged = failures.map((f) => ({ ...f, reasons: [...f.reasons] }));
  for (const finding of reasonLabelFindings(headers)) {
    const existing = merged.find((f) => f.phaseId === finding.phase);
    if (existing) {
      existing.reasons.push(finding.message);
      continue;
    }
    const phase = plan.phases.find((p) => p.id === finding.phase);
    if (phase === undefined) continue;
    merged.push({
      phaseId: phase.id,
      model: phase.model,
      effort: phase.effort,
      reasons: [finding.message],
      alternatives: [],
    });
  }
  return merged;
}

function locateSections(input: RunPreflightInput): LocatedSections {
  return Effect.suspend(() =>
    Either.match(locatePlanSections(input.planMd, input.plan.phases), {
      onLeft: (phases) => Effect.fail(planSectionsRefusal(phases, input.planPath)),
      onRight: (sections) => Effect.succeed(sections),
    }),
  );
}

const checks = {
  "gate-profile": (_input, gateSteps) => Effect.asVoid(gateSteps),

  // Verify all plan-required commands are covered by the frozen set before any
  // git branch, worktree, or agent work begins.
  "required-commands": (input, gateSteps) =>
    Effect.gen(function* () {
      const steps = yield* gateSteps;
      const preflightResult = checkRequiredCommands({
        requiredCommands: input.plan.run.requiredCommands,
        configCommands: input.config.security.agentCommands,
        gateCommands: steps.map((s) => s.command),
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
  // A renamed reason label is a plan-format finding the catalog does not
  // decide; it rides this refusal with lint's text.
  "phase-models": (input, _gateSteps, _planSections, headers) => {
    const modelPreflight = preflightPhaseModels(
      input.plan.phases,
      input.routing,
      input.providerConfig,
    );
    const failures = withLabelFailures(modelPreflight.failures, input.plan, headers);
    if (failures.length === 0) return Effect.void;
    const lines: string[] = [
      `Model preflight failed: ${failures.length} phase(s) have invalid model configuration.`,
    ];
    for (const failure of failures) {
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
        failures: failures.map((f) => ({
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

  // Locate every phase's section in plan.md — all phases, not only those still
  // to run. The prompt builder reads the sections located here.
  "phase-sections": (_input, _gateSteps, planSections) => Effect.asVoid(planSections),

  // A malformed Mode line, or an interactive phase this phax cannot run yet.
  "interactive-phases": (input, _gateSteps, _planSections, headers) => {
    const findings = interactiveFindings(headers);
    if (findings.length === 0) return Effect.void;
    return Effect.fail(
      new InteractivePreflightError({
        message: declarationRefusalMessage("Interactive", findings, input.planPath),
        findings,
        planPath: input.planPath,
      }),
    );
  },

  // The same for the oracle lines.
  "oracle-phases": (input, _gateSteps, _planSections, headers) => {
    const findings = oracleFindings(headers);
    if (findings.length === 0) return Effect.void;
    return Effect.fail(
      new OraclePreflightError({
        message: declarationRefusalMessage("Oracle", findings, input.planPath),
        findings,
        planPath: input.planPath,
      }),
    );
  },
} satisfies Record<
  RunPreflightCheck,
  (
    input: RunPreflightInput,
    gateSteps: GateSteps,
    planSections: LocatedSections,
    headers: readonly PhaseHeader[],
  ) => Effect.Effect<void, RunPreflightError, FileSystem>
>;

/**
 * Run every check in RUN_PREFLIGHT_CHECKS order, stopping at the first refusal.
 * Reads only through the FileSystem port and writes nothing. On success yields
 * the resolved gate steps and the located plan sections.
 */
export function runPreflights(
  input: RunPreflightInput,
): Effect.Effect<
  { readonly gateSteps: readonly GateStep[]; readonly planSections: PlanSections },
  RunPreflightError,
  FileSystem
> {
  return Effect.gen(function* () {
    // Each resolved once, by the first check that needs it, and shared with the rest.
    const gateSteps = yield* Effect.cached(resolveGateSteps(input));
    const planSections = yield* Effect.cached(locateSections(input));
    const headers = readPhaseHeaders(input.planMd);
    for (const id of RUN_PREFLIGHT_CHECKS) {
      yield* checks[id](input, gateSteps, planSections, headers);
    }
    return { gateSteps: yield* gateSteps, planSections: yield* planSections };
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
  /** The plan.md the phases are located in. */
  readonly planMd: string;
  /** The path a phase-sections refusal tells the operator to lint. */
  readonly planPath: string;
  readonly config: ResolvedConfig;
  readonly gateProfileId: string;
  readonly workspaceId?: string | undefined;
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
      planMd: input.planMd,
      planPath: input.planPath,
      config: input.config,
      gateProfileId: input.gateProfileId,
      workspaceId: input.workspaceId,
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
