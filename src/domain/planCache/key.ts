import { createHash } from "node:crypto";

export const EXTRACTOR_VERSION = 1;

/**
 * Content address over plan.md text + model + effort + extractor version.
 * Moving/renaming the file is a hit; any edit is a miss.
 * A different extraction model or a bumped EXTRACTOR_VERSION is also a miss.
 */
export function planCacheKey(
  planMd: string,
  model: string,
  effort: string,
  extractorVersion: number = EXTRACTOR_VERSION,
): string {
  return createHash("sha256")
    .update(
      `planMd\0${planMd}\0model\0${model}\0effort\0${effort}\0extractorVersion\0${String(extractorVersion)}`,
    )
    .digest("hex");
}
