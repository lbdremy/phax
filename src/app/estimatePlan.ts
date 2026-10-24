// `phax plans estimate`'s use case. The plan is read by the deterministic
// parser `phax plans lint` uses, through FileSystem alone, so no model ever
// reads it. Each phase is routed as `phax run` routes it, through the shared
// `securityFilterFor`. The history comes from this machine's cost ledgers and
// git; the windows from one Claude Code probe that never sees the plan, or,
// without the probe, from the ledgers' last rate-limit sample with no Backend
// call at all. No Claude Code credential is read on any path.
import { Effect, Either } from "effect";
import { join } from "node:path";
import { classifyArtifactPath, validateArtifact } from "../domain/artifact/document.js";
import {
  estimatePlan,
  type ComplianceInput,
  type EstimateReport,
  type PlanPhaseInput,
  type WindowsReading,
} from "../domain/cost/estimate.js";
import { lastObservedWindows } from "../domain/cost/history.js";
import {
  PlanUnparseableError,
  type ArtifactValidationError,
  type ConfigValidationError,
  type RegistryCorruptionError,
} from "../domain/errors.js";
import { finalizeExtractedPlan } from "../domain/plan/finalize.js";
import { extractPlanDeterministic } from "../domain/plan/parsePlanMarkdown.js";
import { resolveModel } from "../domain/routing/resolve.js";
import { securityFilterFor } from "../domain/security/capabilities.js";
import { resolveSecurityPolicy } from "../domain/security/resolvePolicy.js";
import type { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { Git } from "../ports/git.js";
import type { Lock } from "../ports/lock.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import { backfillCostLedgers } from "./costBackfill.js";
import { readEstimateHistory, type SkippedHistory } from "./estimateHistory.js";
import { loadModelRouting, loadProviderConfig } from "./loadRouting.js";
import { probeWindows } from "./probeWindows.js";

export interface EstimatePlanOptions {
  /** Absolute path the plan is read from. */
  readonly planMdPath: string;
  /**
   * The plan's path relative to `config.repoRoot`, POSIX-separated. A plan
   * under `docs/plans/` must pass artifact validation first.
   */
  readonly repoRelPath: string;
  readonly config: ResolvedConfig;
}

/** A plan phase as the plan asks for it, with its planned files sized in the working tree. */
export interface SizedPlanPhase {
  readonly phase: PhaxPlanPhase;
  readonly editBytes: number;
  readonly optionalBytes: number;
  readonly createCount: number;
}

export type EstimatePlanError =
  | FsError
  | ConfigValidationError
  | ArtifactValidationError
  | RegistryCorruptionError
  | PlanUnparseableError;

function sizeOf(
  repoRoot: string,
  paths: readonly string[],
): Effect.Effect<number, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    let total = 0;
    // Only regular files count, as git blobs do for history: a directory, or
    // a path absent from the working tree, measures 0.
    for (const path of paths) total += yield* fs.fileSize(join(repoRoot, path));
    return total;
  });
}

/**
 * Reads the plan model-free, validating it first when it is an artifact under
 * `docs/plans/`, and sizes each phase's planned files in the working tree.
 * Requires FileSystem only: no Backend can reach the plan.
 */
export function readEstimatePlan(
  opts: EstimatePlanOptions,
): Effect.Effect<
  readonly SizedPlanPhase[],
  FsError | ArtifactValidationError | PlanUnparseableError,
  FileSystem
> {
  const { planMdPath, repoRelPath, config } = opts;
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const planMd = yield* fs.readText(planMdPath);

    if (classifyArtifactPath(repoRelPath) !== null) {
      const validated = validateArtifact(repoRelPath, planMd);
      if (Either.isLeft(validated)) return yield* Effect.fail(validated.left);
    }

    const unparseable = (reason: string) =>
      new PlanUnparseableError({
        path: repoRelPath,
        message: `${repoRelPath} cannot be parsed: ${reason}. Run \`phax plans lint ${repoRelPath}\` for every finding.`,
      });
    const extracted = extractPlanDeterministic(planMd);
    if (Either.isLeft(extracted)) return yield* Effect.fail(unparseable(extracted.left.message));
    const finalized = finalizeExtractedPlan(extracted.right, planMd);
    if (Either.isLeft(finalized)) return yield* Effect.fail(unparseable(finalized.left.message));

    const phases: SizedPlanPhase[] = [];
    for (const phase of finalized.right.plan.phases) {
      phases.push({
        phase,
        editBytes: yield* sizeOf(config.repoRoot, phase.plannedFilesToEdit),
        optionalBytes: yield* sizeOf(config.repoRoot, phase.optionalFilesToEdit),
        createCount: phase.plannedFilesToCreate.length,
      });
    }
    return phases;
  });
}

/** The report, and how many cost ledgers the estimate backfilled first. */
export interface EstimatePlanResult {
  readonly report: EstimateReport;
  readonly backfilledLedgers: number;
}

/**
 * The plan's `EstimateReport`. Every kept run with no cost ledger first gets
 * one, as `phax cost backfill` writes it: the estimate is the ledgers' only
 * reader, so a person never has to run the backfill by hand. A backfill that
 * fails becomes a warning, never a failed estimate. With `probe`, the windows
 * come from one Claude Code probe; without it, from the ledgers' last
 * rate-limit sample, and no Backend method is called. Skipped history files
 * become warnings, named by path and reason.
 */
export function estimatePlanCost(
  opts: EstimatePlanOptions & { readonly nowIso: string; readonly probe: boolean },
): Effect.Effect<EstimatePlanResult, EstimatePlanError, FileSystem | Git | Backend | Lock> {
  const { config, nowIso } = opts;
  return Effect.gen(function* () {
    const planned = yield* readEstimatePlan(opts);

    const routing = yield* loadModelRouting();
    const providerConfig = yield* loadProviderConfig();
    const filter = securityFilterFor(
      resolveSecurityPolicy({
        mode: config.security.profile,
        worktreePath: config.repoRoot,
        config: config.security,
      }),
    );
    const phases: PlanPhaseInput[] = planned.map(
      ({ phase, editBytes, optionalBytes, createCount }) => {
        const { selected } = resolveModel(
          { model: phase.model, effort: phase.effort },
          routing,
          providerConfig,
          filter,
        );
        return {
          id: phase.id,
          provider: selected.provider,
          model: selected.concreteModel,
          effort: phase.effort,
          mode: phase.mode,
          editBytes,
          optionalBytes,
          createCount,
        };
      },
    );

    // Routed as `executePlan` routes the review once the run's phases are done.
    const compliance: ComplianceInput = !config.complianceReview.enabled
      ? { kind: "disabled" }
      : resolveModel(
            { model: config.complianceReview.model, effort: config.complianceReview.effort },
            routing,
            providerConfig,
            filter,
          ).selected.provider === "claude-code"
        ? { kind: "claude-code" }
        : { kind: "other-provider" };

    const backfill = yield* backfillCostLedgers({ stateRoot: config.stateRoot }).pipe(
      Effect.map((result) => ({ written: result.written.length, failure: null })),
      Effect.catchTag("FsError", (error) => Effect.succeed({ written: 0, failure: error.message })),
    );

    const history = yield* readEstimateHistory({
      stateRoot: config.stateRoot,
      repoRoot: config.repoRoot,
      namespace: config.namespace,
    });

    const nowMs = Date.parse(nowIso);
    const windows: WindowsReading = opts.probe
      ? yield* probeWindows(nowIso)
      : lastObservedWindows(history.ledgers, nowMs);

    const report = estimatePlan({
      phases,
      ledgers: history.ledgers,
      sizedRuns: history.sizedRuns,
      unledgeredRuns: history.unledgeredRuns,
      compliance,
      windows,
      nowMs,
    });
    const warnings = [
      ...report.warnings,
      ...(backfill.failure === null
        ? []
        : [`the cost backfill failed (${backfill.failure}); run \`phax cost backfill\``]),
      ...skippedWarnings(history.skipped),
    ];
    return { report: { ...report, warnings }, backfilledLedgers: backfill.written };
  });
}

const SKIPPED_PATHS_SHOWN = 3;

/**
 * One warning per reason, naming its first paths: old runs whose
 * phax-plan.json predates the current format would otherwise print a line
 * each on every estimate.
 */
function skippedWarnings(skipped: readonly SkippedHistory[]): string[] {
  const byReason = new Map<string, string[]>();
  for (const { path, reason } of skipped) {
    const paths = byReason.get(reason);
    if (paths === undefined) byReason.set(reason, [path]);
    else paths.push(path);
  }
  return [...byReason].map(([reason, paths]) => {
    if (paths.length === 1) return `${paths[0]}: ${reason}`;
    const shown = paths.slice(0, SKIPPED_PATHS_SHOWN).join(", ");
    const more = paths.length - SKIPPED_PATHS_SHOWN;
    return `${paths.length} files: ${reason} — ${shown}${more > 0 ? ` and ${more} more` : ""}`;
  });
}
