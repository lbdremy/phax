/**
 * `value` with every string in it on one line: each run of line breaks and the
 * spaces around it becomes one space. A report's text is the provider's, and
 * phax renders it one item per line — a pushed-brief line, a fix-prompt
 * finding, a review-note bullet — so a line break inside it would fake a
 * markdown heading or slip past the pushed brief's line cap.
 */
export function onOneLine<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\s*[\r\n]+\s*/g, " ") as T;
  if (Array.isArray(value)) return value.map(onOneLine) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, onOneLine(entry)]),
    ) as T;
  }
  return value;
}
