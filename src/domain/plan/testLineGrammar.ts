import { Either, Schema } from "effect";
import { liftTestLoop, type TestLineToLift } from "../../schemas/acceptanceLift.js";
import {
  TEST_LOOPS,
  TEST_SIZES,
  TEST_TECHNIQUES,
  TestLineSchema,
  type TestLine,
} from "../../schemas/testLine.js";

// The test line grammar: one line of a phase's `### Test strategy` section,
// `<guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`,
// read from the right. Pure, and imports only `effect`, the test line schema
// and the loop lift, because the schemas package reads older plan sidecars
// through it.
// Reading a rendered section returns its lines: for every list of lines,
// `readTestStrategyText(lines.map((l) => `- ${renderTestLine(l)}`).join("\n"))`
// returns them, with no departure.

const DASH = " — ";
const DOT = " · ";

/**
 * A section item that is not a test line: its source item number, its text,
 * and its kind. `retired-loop` is a line that reads only under the loops
 * before 0.33.0 (its loop is `oracle`); any other departure is `format`.
 */
export interface TestLineDeparture {
  readonly line: number;
  readonly text: string;
  readonly kind: "format" | "retired-loop";
}

/** A test line with its source item number, counting stray items. */
interface NumberedTestLine {
  readonly item: number;
  readonly line: TestLine;
}

export interface TestStrategyReading {
  readonly lines: ReadonlyArray<NumberedTestLine>;
  readonly departures: ReadonlyArray<TestLineDeparture>;
}

/** One line, without its `- ` bullet and unescaped; a line of a shape before 0.33.0 as it was written. */
export function renderTestLine(line: TestLine | TestLineToLift): string {
  const fields = [line.size, line.technique, line.oracle, line.loop];
  const coordinates = (line.criterion === null ? fields : [...fields, line.criterion]).join(DOT);
  return `${line.guarantee}${DASH}${coordinates}`;
}

const decodeTestLine = Schema.decodeUnknownEither(TestLineSchema, { onExcessProperty: "error" });

const COORDINATES_START = new RegExp(
  `^(?:${TEST_SIZES.join("|")})${DOT}(?:${TEST_TECHNIQUES.join("|")})${DOT}`,
);

/** How a section is read: `beforeAcceptance` reads a section written before 0.33.0, whose loop `oracle` is now `acceptance`. */
export interface TestLineReadOptions {
  readonly beforeAcceptance?: boolean;
}

// The loop words a line may end with. A section written before 0.33.0 knew only
// `oracle` and `in-phase`, and `liftTestLoop` reads its `oracle` as
// `acceptance`. There, a trailing `acceptance` was a criterion, which the
// schema now refuses, so the line departs instead of being read with another
// loop. No older line holds `oracle` as a criterion (it was reserved).
const LOOPS_BEFORE_ACCEPTANCE: ReadonlyArray<string> = ["oracle", "in-phase"];

function isLoop(field: string, options: TestLineReadOptions): boolean {
  const loops: ReadonlyArray<string> =
    options.beforeAcceptance === true ? LOOPS_BEFORE_ACCEPTANCE : TEST_LOOPS;
  return loops.includes(field);
}

function asLoop(field: string): string {
  return field === "oracle" ? liftTestLoop("oracle") : field;
}

// The guarantee ends at the last ` — ` followed by a size, ` · `, a
// technique and ` · `; -1 when there is none.
function coordinatesStart(text: string): number {
  for (let at = text.lastIndexOf(DASH); at >= 0; at = text.lastIndexOf(DASH, at - 1)) {
    if (COORDINATES_START.test(text.slice(at + DASH.length))) return at;
    if (at === 0) break;
  }
  return -1;
}

/**
 * Reads one entry's text as a test line, or null when it departs: no
 * coordinates, a loop missing, or a value the schema refuses.
 */
export function parseTestLine(text: string, options: TestLineReadOptions = {}): TestLine | null {
  const at = coordinatesStart(text);
  if (at < 0) return null;
  const guarantee = text.slice(0, at);
  const [size = "", technique = "", ...rest] = text.slice(at + DASH.length).split(DOT);
  const last = rest.at(-1);
  if (last === undefined) return null;
  let loop: string;
  let criterion: string | null;
  let oracleFields: string[];
  if (isLoop(last, options)) {
    loop = asLoop(last);
    criterion = null;
    oracleFields = rest.slice(0, -1);
  } else {
    const beforeLast = rest.at(-2);
    if (beforeLast === undefined || !isLoop(beforeLast, options)) return null;
    loop = asLoop(beforeLast);
    criterion = last;
    oracleFields = rest.slice(0, -2);
  }
  if (oracleFields.length === 0) return null;
  const decoded = decodeTestLine({
    guarantee,
    size,
    technique,
    oracle: oracleFields.join(DOT),
    loop,
    criterion,
  });
  return Either.isRight(decoded) ? decoded.right : null;
}

// `[\s\S]`, not `.`, which stops at U+2028 and U+2029: an entry holding one is
// still an entry, and its departure quotes it without the bullet.
const BULLET = /^ {0,3}[-*+] ([\s\S]*)$/;
const NONE_ITEM = /^\(?none\)?$/i;
// Line breaks a `\r?\n` split leaves inside a line.
const UNICODE_BREAK = new RegExp("[\\u2028\\u2029\\u0085]");

interface Item {
  readonly number: number;
  readonly stray: boolean;
  text: string;
  broken: boolean;
}

/**
 * Reads a `### Test strategy` section's text into its test lines and its
 * departures. Each source line drops its trailing whitespace. A `- `, `* ` or
 * `+ ` bullet (after at most three spaces) starts an entry; a following
 * non-blank line with no blank line in between continues the current item,
 * trimmed and joined with one space; any other non-blank line starts a stray
 * item. Items are numbered from 1. A lone `(none)` item, or no item, is no
 * line. Every item that is not a test line departs: a stray item, an entry
 * `parseTestLine` refuses, an item holding U+2028, U+2029 or U+0085, and
 * `(none)` beside other items. A section written before 0.33.0 is read with
 * `beforeAcceptance`, so its loop `oracle` reads as `acceptance`. Without it,
 * an entry that departs but reads under the loops before 0.33.0 departs as
 * `retired-loop`; with it, every departure is `format`.
 */
export function readTestStrategyText(
  text: string,
  options: TestLineReadOptions = {},
): TestStrategyReading {
  const items: Item[] = [];
  let previousBlank = true;
  for (const raw of text.split(/\r?\n/)) {
    const broken = UNICODE_BREAK.test(raw);
    const source = raw.trimEnd();
    if (source.length === 0 && !broken) {
      previousBlank = true;
      continue;
    }
    const bullet = BULLET.exec(source);
    const current = items.at(-1);
    if (bullet !== null) {
      items.push({
        number: items.length + 1,
        stray: false,
        text: (bullet[1] ?? "").trim(),
        broken,
      });
    } else if (!previousBlank && current !== undefined) {
      current.text = `${current.text} ${source.trim()}`;
      current.broken ||= broken;
    } else {
      items.push({ number: items.length + 1, stray: true, text: source.trim(), broken });
    }
    previousBlank = false;
  }

  const [only] = items;
  if (items.length === 1 && only !== undefined && !only.broken && NONE_ITEM.test(only.text)) {
    return { lines: [], departures: [] };
  }

  const lines: NumberedTestLine[] = [];
  const departures: TestLineDeparture[] = [];
  for (const item of items) {
    const readable = !item.stray && !item.broken;
    const line = readable ? parseTestLine(item.text, options) : null;
    if (line !== null) {
      lines.push({ item: item.number, line });
      continue;
    }
    const retired =
      readable &&
      options.beforeAcceptance !== true &&
      parseTestLine(item.text, { beforeAcceptance: true }) !== null;
    departures.push({
      line: item.number,
      text: item.text,
      kind: retired ? "retired-loop" : "format",
    });
  }
  return { lines, departures };
}

/**
 * `test line <n> uses the loop 'oracle', which is no longer read: write
 * 'acceptance'` for a `retired-loop` departure; `test line <n> departs from
 * the format: "<text>"` otherwise.
 */
export function departureMessage(d: TestLineDeparture): string {
  if (d.kind === "retired-loop") {
    return `test line ${String(d.line)} uses the loop 'oracle', which is no longer read: write 'acceptance'`;
  }
  return `test line ${String(d.line)} departs from the format: "${d.text}"`;
}
