import { Either, Schema } from "effect";
import {
  TEST_LOOPS,
  TEST_SIZES,
  TEST_TECHNIQUES,
  TestLineSchema,
  type TestLine,
  type TestLoop,
} from "../../schemas/testLine.js";

// The test line grammar: one line of a phase's `### Test strategy` section,
// `<guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`,
// read from the right. Pure, and imports only `effect` and the test line
// schema, because the schemas package reads older plan sidecars through it.
// Reading a rendered section returns its lines: for every list of lines,
// `readTestStrategyText(lines.map((l) => `- ${renderTestLine(l)}`).join("\n"))`
// returns them, with no departure.

const DASH = " — ";
const DOT = " · ";

/** A section item that is not a test line: its source item number and its text. */
export interface TestLineDeparture {
  readonly line: number;
  readonly text: string;
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

/** One line, without its `- ` bullet and unescaped. */
export function renderTestLine(line: TestLine): string {
  const fields = [line.size, line.technique, line.oracle, line.loop];
  const coordinates = (line.criterion === null ? fields : [...fields, line.criterion]).join(DOT);
  return `${line.guarantee}${DASH}${coordinates}`;
}

const decodeTestLine = Schema.decodeUnknownEither(TestLineSchema, { onExcessProperty: "error" });

const COORDINATES_START = new RegExp(
  `^(?:${TEST_SIZES.join("|")})${DOT}(?:${TEST_TECHNIQUES.join("|")})${DOT}`,
);

function isLoop(field: string): field is TestLoop {
  return (TEST_LOOPS as ReadonlyArray<string>).includes(field);
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
export function parseTestLine(text: string): TestLine | null {
  const at = coordinatesStart(text);
  if (at < 0) return null;
  const guarantee = text.slice(0, at);
  const [size = "", technique = "", ...rest] = text.slice(at + DASH.length).split(DOT);
  const last = rest.at(-1);
  if (last === undefined) return null;
  let loop: string;
  let criterion: string | null;
  let oracleFields: string[];
  if (isLoop(last)) {
    loop = last;
    criterion = null;
    oracleFields = rest.slice(0, -1);
  } else {
    const beforeLast = rest.at(-2);
    if (beforeLast === undefined || !isLoop(beforeLast)) return null;
    loop = beforeLast;
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

const BULLET = /^ {0,3}[-*+] (.*)$/;
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
 * `(none)` beside other items.
 */
export function readTestStrategyText(text: string): TestStrategyReading {
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
    const line = item.stray || item.broken ? null : parseTestLine(item.text);
    if (line === null) departures.push({ line: item.number, text: item.text });
    else lines.push({ item: item.number, line });
  }
  return { lines, departures };
}

/** `test line <n> departs from the format: "<text>"`. */
export function departureMessage(d: TestLineDeparture): string {
  return `test line ${String(d.line)} departs from the format: "${d.text}"`;
}
