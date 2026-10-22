import type { FirstReading } from "../../schemas/firstReading.js";

/**
 * The markdown of `first-reading.md`: the pattern at stake, what each
 * upcoming phase copies, and what to check. An empty list reads as a plain
 * sentence rather than an empty heading.
 */
export function renderFirstReading(doc: FirstReading): string {
  return [
    "# First reading",
    "",
    "## The pattern at stake",
    ...doc.pattern.map((item) => `- ${item}`),
    "",
    "## What the upcoming phases copy",
    ...(doc.copiedBy.length === 0
      ? ["None of the upcoming phases copies it."]
      : doc.copiedBy.map((c) => `- ${c.phase}: ${c.what}`)),
    "",
    "## What to check",
    ...(doc.toCheck.length === 0 ? ["Nothing flagged."] : doc.toCheck.map((item) => `- ${item}`)),
    "",
  ].join("\n");
}
