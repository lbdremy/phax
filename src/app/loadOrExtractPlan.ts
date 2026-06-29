import { Effect, Either, Option } from "effect";
import { Backend } from "../ports/backend.js";
import { FileSystem } from "../ports/fs.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import { PlanValidationError } from "../domain/errors.js";
import { planCacheKey, EXTRACTOR_VERSION } from "../domain/planCache/key.js";
import { finalizeExtractedPlan } from "../domain/plan/finalize.js";
import { extractPlanLlm, type ExtractPlanCoreError } from "./extractPlan.js";
import { readCacheEntry, writeCacheEntry, planMdSha256 } from "./planCacheStore.js";

export interface LoadOrExtractOptions {
  readonly planMdPath: string;
  readonly model: string;
  readonly effort: string;
  readonly stateRoot: string;
  readonly nowIso: string;
  readonly refresh?: boolean | undefined;
  readonly noExtract?: boolean | undefined;
}

export interface LoadOrExtractResult {
  readonly plan: PhaxPlan;
  readonly warnings: string[];
  readonly fromCache: boolean;
}

export function loadOrExtractPlan(
  opts: LoadOrExtractOptions,
): Effect.Effect<LoadOrExtractResult, ExtractPlanCoreError, Backend | FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const planMd = yield* fs.readText(opts.planMdPath);
    const key = planCacheKey(planMd, opts.model, opts.effort);

    if (!opts.refresh) {
      const cached = yield* readCacheEntry(opts.stateRoot, key);
      if (Option.isSome(cached)) {
        const finalized = finalizeExtractedPlan(cached.value, planMd);
        if (Either.isLeft(finalized)) {
          return yield* Effect.fail(finalized.left);
        }
        const { plan, warnings } = finalized.right;
        return { plan, warnings, fromCache: true };
      }
    }

    if (opts.noExtract) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `No cached extraction for "${opts.planMdPath}"; run \`phax extract-plan\` or drop --no-extract.`,
          path: opts.planMdPath,
        }),
      );
    }

    const extracted = yield* extractPlanLlm(planMd, { model: opts.model, effort: opts.effort });

    yield* writeCacheEntry(opts.stateRoot, key, {
      planMdSha256: planMdSha256(planMd),
      model: opts.model,
      effort: opts.effort,
      extractorVersion: EXTRACTOR_VERSION,
      extractedAt: opts.nowIso,
      extracted,
    });

    const finalized = finalizeExtractedPlan(extracted, planMd);
    if (Either.isLeft(finalized)) {
      return yield* Effect.fail(finalized.left);
    }

    const { plan, warnings } = finalized.right;
    return { plan, warnings, fromCache: false };
  });
}
