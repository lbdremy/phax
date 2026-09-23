import { createHash } from "node:crypto";
import { splitFrontmatter } from "../artifact/frontmatter.js";

// 2: the key hashes the plan body without its frontmatter block (was: the whole file).
export const EXTRACTOR_VERSION = 2;

/**
 * Content address over the plan.md body + model + effort + extractor version.
 * The body is the text after the frontmatter block (the whole text when there is
 * none), so a lifecycle transition that rewrites only the frontmatter — `artifact
 * approve` stamping `status`/`approved` — keeps the key: a seed written at Draft
 * still matches at run time. Moving, renaming or transitioning the file is a hit;
 * any body edit is a miss. A different extraction model or a bumped
 * EXTRACTOR_VERSION is also a miss.
 */
export function planCacheKey(
  planMd: string,
  model: string,
  effort: string,
  extractorVersion: number = EXTRACTOR_VERSION,
): string {
  const body = splitFrontmatter(planMd)?.body ?? planMd;
  return createHash("sha256")
    .update(
      `planMd\0${body}\0model\0${model}\0effort\0${effort}\0extractorVersion\0${String(extractorVersion)}`,
    )
    .digest("hex");
}
