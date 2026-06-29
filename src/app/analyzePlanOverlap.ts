import { Data, Effect, Either } from "effect";
import { Backend } from "../ports/backend.js";
import { FileSystem } from "../ports/fs.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import { computePlanOverlap } from "../domain/planOverlap/compute.js";
import type { PlanInput, PlanOverlapResult } from "../domain/planOverlap/types.js";
import { loadOrExtractPlan } from "./loadOrExtractPlan.js";

export class AnalyzePlanOverlapError extends Data.TaggedError("AnalyzePlanOverlapError")<{
  readonly message: string;
}> {}

export interface AnalyzePlanOverlapOptions {
  readonly model: string;
  readonly effort: string;
  readonly stateRoot: string;
  readonly noExtract: boolean;
  readonly nowIso: string;
}

function planToPlanInput(plan: PhaxPlan, path: string): PlanInput {
  return {
    id: path,
    label: `${plan.run.shortName} (${path})`,
    phases: plan.phases.map((p) => ({
      create: p.plannedFilesToCreate,
      edit: p.plannedFilesToEdit,
      optional: p.optionalFilesToEdit,
    })),
  };
}

export function loadAndMapPlanInput(
  planMdPath: string,
  opts: AnalyzePlanOverlapOptions,
): Effect.Effect<PlanInput, AnalyzePlanOverlapError, Backend | FileSystem> {
  return loadOrExtractPlan({
    planMdPath,
    model: opts.model,
    effort: opts.effort,
    stateRoot: opts.stateRoot,
    noExtract: opts.noExtract,
    nowIso: opts.nowIso,
  }).pipe(
    Effect.mapError(
      (e) =>
        new AnalyzePlanOverlapError({
          message: `Failed to load "${planMdPath}": ${"message" in e ? e.message : String(e)}`,
        }),
    ),
    Effect.map(({ plan }) => planToPlanInput(plan, planMdPath)),
  );
}

export function analyzePlanOverlap(
  planMdPaths: readonly string[],
  opts: AnalyzePlanOverlapOptions,
): Effect.Effect<PlanOverlapResult, AnalyzePlanOverlapError, Backend | FileSystem> {
  return Effect.gen(function* () {
    // Deduplicate paths while preserving order
    const seen = new Set<string>();
    const uniquePaths: string[] = [];
    for (const p of planMdPaths) {
      if (!seen.has(p)) {
        seen.add(p);
        uniquePaths.push(p);
      }
    }

    if (uniquePaths.length < 2) {
      return yield* Effect.fail(
        new AnalyzePlanOverlapError({
          message: "plans-overlap requires two or more distinct plan.md paths to compare.",
        }),
      );
    }

    // Attempt to load all plans, collecting failures
    const results = yield* Effect.all(
      uniquePaths.map((path) => loadAndMapPlanInput(path, opts).pipe(Effect.either)),
    );

    const failures: string[] = [];
    const inputs: PlanInput[] = [];
    for (const result of results) {
      if (Either.isLeft(result)) {
        failures.push(result.left.message);
      } else {
        inputs.push(result.right);
      }
    }

    if (failures.length > 0) {
      return yield* Effect.fail(
        new AnalyzePlanOverlapError({
          message: `Failed to load the following plans:\n${failures.map((f) => `  • ${f}`).join("\n")}`,
        }),
      );
    }

    return computePlanOverlap(inputs);
  });
}
