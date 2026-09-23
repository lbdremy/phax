// Markdown building blocks shared by the spec and plan renderers. Pure and
// total: every function maps any string to the same output, every time.

/** `\r\n` and lone `\r` become `\n`; the text ends with exactly one newline. */
export function finishDocument(blocks: readonly string[]): string {
  const text = blocks.join("\n\n").replace(/\r\n?/g, "\n");
  return `${text.replace(/\n+$/, "")}\n`;
}

/**
 * A list item whose continuation lines are indented under the marker, so a
 * multi-line entry stays inside its item (a heading-like line in it cannot
 * close the enclosing section).
 */
export function listItem(marker: string, text: string): string {
  const indent = " ".repeat(marker.length + 1);
  const [first = "", ...rest] = text.split(/\r\n?|\n/);
  const continuation = rest.map((line) => (line.length === 0 ? "" : `${indent}${line}`));
  return [`${marker} ${first}`, ...continuation].join("\n");
}

export function bulletList(items: readonly string[]): string {
  return items.map((item) => listItem("-", item)).join("\n");
}

/**
 * A code span whose text content is exactly `text`: the fence is one backtick
 * longer than the longest backtick run inside, padded with a space when the
 * content would otherwise touch the fence or lose a leading/trailing space.
 */
export function inlineCode(text: string): string {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longestRun + 1);
  const pad = text.includes("`") || (text.startsWith(" ") && text.endsWith(" ")) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Appends a full stop unless the text already ends a sentence. */
export function sentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Headings are single lines: interior line breaks fold to one space. */
export function headingText(text: string): string {
  return text.replace(/\s*(?:\r\n?|\n)\s*/g, " ").trim();
}
