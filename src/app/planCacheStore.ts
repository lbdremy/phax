import { Effect, Either, Option } from "effect";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EXTRACTOR_VERSION, planCacheKey } from "../domain/planCache/key.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { ExtractedPhaxPlan } from "../schemas/phaxPlan.js";
import { type PlanDocument, projectExtractedPlan } from "../schemas/planDocument.js";
import {
  decodeExtractedPlanCacheEntry,
  encodeExtractedPlanCacheEntry,
  type ExtractedPlanCacheEntry,
} from "../schemas/extractedPlanCacheEntry.js";

export function cacheEntryPath(stateRoot: string, key: string): string {
  return join(stateRoot, "cache", "plans", key + ".json");
}

export function readCacheEntry(
  stateRoot: string,
  key: string,
): Effect.Effect<Option.Option<ExtractedPhaxPlan>, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = cacheEntryPath(stateRoot, key);

    const text = yield* fs.readText(path).pipe(Effect.option);
    if (Option.isNone(text)) return Option.none();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.value);
    } catch {
      return Option.none();
    }

    const decoded = decodeExtractedPlanCacheEntry(parsed);
    if (Either.isLeft(decoded)) return Option.none();

    return Option.some(decoded.right.extracted);
  });
}

export function writeCacheEntry(
  stateRoot: string,
  key: string,
  entry: Omit<ExtractedPlanCacheEntry, "version" | "key">,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = cacheEntryPath(stateRoot, key);
    const dir = join(stateRoot, "cache", "plans");

    yield* fs.mkdirp(dir);

    const full: ExtractedPlanCacheEntry = {
      version: 1,
      key,
      ...entry,
    };

    yield* fs.writeAtomic(path, JSON.stringify(encodeExtractedPlanCacheEntry(full), null, 2));
  });
}

export interface PlanCacheSeed {
  readonly stateRoot: string;
  /** The plan file as written, frontmatter included. */
  readonly planMd: string;
  readonly document: PlanDocument;
  readonly extractPlanModel: string;
  readonly extractPlanEffort: string;
  readonly nowIso: string;
}

/**
 * Seeds the extraction cache with a plan document's projection, keyed on the
 * plan as written, so `phax run` never extracts it through a model. Headless
 * authoring and `phax artifact migrate-documents` both seed through it.
 */
export function seedPlanCache(seed: PlanCacheSeed): Effect.Effect<void, FsError, FileSystem> {
  const key = planCacheKey(seed.planMd, seed.extractPlanModel, seed.extractPlanEffort);
  return writeCacheEntry(seed.stateRoot, key, {
    planMdSha256: planMdSha256(seed.planMd),
    model: seed.extractPlanModel,
    effort: seed.extractPlanEffort,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: seed.nowIso,
    extracted: projectExtractedPlan({ version: 1, ...seed.document }),
  });
}

export function planMdSha256(planMd: string): string {
  return createHash("sha256").update(planMd).digest("hex");
}
