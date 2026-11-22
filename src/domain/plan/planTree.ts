/**
 * The one place a plan body is parsed. `readPlanTree` measures each body
 * line's blockquote and list nesting in one linear pass, and refuses a plan
 * with a line deeper than the limit before the Markdown parser sees it: a deep
 * enough container run costs the parser seconds of CPU. Pure: no I/O.
 */
import { Result } from "effect";
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { splitFrontmatter } from "../artifact/frontmatter.js";

const NESTING_LIMIT = 32;

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const GT = 62;
const DASH = 45;
const PLUS = 43;
const STAR = 42;
const DOT = 46;
const CLOSE_PAREN = 41;
const ZERO = 48;
const NINE = 57;
const MAX_ORDERED_DIGITS = 9;

const isDigit = (code: number): boolean => code >= ZERO && code <= NINE;

// After a list marker: a space, a tab, a line ending or the end of the text.
const endsListMarker = (code: number): boolean =>
  Number.isNaN(code) || code === SPACE || code === TAB || code === LF || code === CR;

// The end of the list marker that starts at `at` (a bullet, or 1 to 9 digits
// then `.` or `)`), when a space, a tab or the line end follows it; -1 otherwise.
function listMarkerEnd(text: string, at: number): number {
  const code = text.charCodeAt(at);
  if (code === DASH || code === PLUS || code === STAR) {
    return endsListMarker(text.charCodeAt(at + 1)) ? at + 1 : -1;
  }
  let end = at;
  while (end - at < MAX_ORDERED_DIGITS && isDigit(text.charCodeAt(end))) end += 1;
  if (end === at) return -1;
  const delimiter = text.charCodeAt(end);
  if (delimiter !== DOT && delimiter !== CLOSE_PAREN) return -1;
  return endsListMarker(text.charCodeAt(end + 1)) ? end + 1 : -1;
}

// The nesting estimate of the line starting at `start`, read from its leading
// container prefix: markers + floor(counted whitespace / 2). It stops as soon
// as the estimate passes the limit, so a line is read at most up to there.
//
// Why it never under-counts: the line that opens a container at depth d
// matches every ancestor explicitly before its last marker. A continued list
// item needs at least 2 columns of whitespace, a new list marker is followed
// by whitespace, and a blockquote has its `>`; whitespace that precedes a
// marker is counted. So that line's estimate is at least d. A lazy
// continuation line never opens a container. The measure is exact for
// 2-column list nesting and `> ` quotes; it may over-count elsewhere (a `>` or
// `-` in fenced code, `- - -`, wider indents).
function lineDepth(text: string, start: number): number {
  let at = start;
  let column = 0;
  let markers = 0;
  let pending = 0;
  let counted = 0;
  const marker = (): boolean => {
    markers += 1;
    counted += pending;
    pending = 0;
    return markers + Math.floor(counted / 2) > NESTING_LIMIT;
  };
  for (;;) {
    const code = text.charCodeAt(at);
    if (code === SPACE) {
      pending += 1;
      column += 1;
      at += 1;
    } else if (code === TAB) {
      const width = 4 - (column % 4);
      pending += width;
      column += width;
      at += 1;
    } else if (code === GT) {
      if (marker()) break;
      at += 1;
      column += 1;
      const next = text.charCodeAt(at);
      if (next === SPACE) {
        at += 1;
        column += 1;
      } else if (next === TAB) {
        const width = 4 - (column % 4);
        pending += width - 1;
        column += width;
        at += 1;
      }
    } else {
      const end = listMarkerEnd(text, at);
      if (end === -1) break;
      if (marker()) break;
      column += end - at;
      at = end;
    }
  }
  return markers + Math.floor(counted / 2);
}

// The 0-based index, among the body's lines, of the first line deeper than the
// limit; -1 when none is. Line endings are `\r\n`, `\r` and `\n`, as micromark
// reads them.
function firstLineOverLimit(body: string): number {
  let start = 0;
  let line = 0;
  for (;;) {
    if (lineDepth(body, start) > NESTING_LIMIT) return line;
    let at = start;
    while (at < body.length) {
      const code = body.charCodeAt(at);
      if (code === LF || code === CR) break;
      at += 1;
    }
    if (at >= body.length) return -1;
    start = body.charCodeAt(at) === CR && body.charCodeAt(at + 1) === LF ? at + 2 : at + 1;
    line += 1;
  }
}

function countLineEndings(text: string): number {
  let count = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code === LF) count += 1;
    else if (code === CR && text.charCodeAt(at + 1) !== LF) count += 1;
  }
  return count;
}

/**
 * The plan body (frontmatter skipped) and its mdast tree; or, when a body line
 * nests blockquotes and lists over 32 levels deep, a refusal naming that
 * line's 1-based number in the plan file (frontmatter lines counted), with no
 * parse.
 */
export function readPlanTree(
  planMd: string,
): Result.Result<
  { readonly body: string; readonly root: Root },
  { readonly line: number; readonly message: string }
> {
  const body = splitFrontmatter(planMd)?.body ?? planMd;
  const overIndex = firstLineOverLimit(body);
  if (overIndex === -1) return Result.succeed({ body, root: fromMarkdown(body) });
  const line = countLineEndings(planMd.slice(0, planMd.length - body.length)) + overIndex + 1;
  return Result.fail({
    line,
    message: `line ${line}: blockquotes and lists nest over ${NESTING_LIMIT} levels deep`,
  });
}
