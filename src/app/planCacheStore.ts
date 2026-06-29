import { Effect, Either, Option } from "effect";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { ExtractedPhaxPlan } from "../schemas/phaxPlan.js";
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

export function planMdSha256(planMd: string): string {
  return createHash("sha256").update(planMd).digest("hex");
}
