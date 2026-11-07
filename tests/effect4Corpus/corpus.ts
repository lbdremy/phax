// The behaviour corpus of the Effect 4 migration: case files whose expectations
// were captured on Effect 3, replayed on every later tree. This module is
// Effect-free and stays byte-identical through the migration: it holds the
// case-file shape and its guard, the input envelopes a subject reads, the
// canonical encoder both sides of a comparison go through, and `captureFile`,
// which fills only the expectations still null. `subjects.ts` is the one
// corpus module that touches Effect.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** What one case decodes to: the decoded value as plain data, or the refusal line phax prints. */
export type Expected =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly refusal: string };

/** One input of a subject. `expected` is null until the capture script fills it. */
interface Case {
  readonly name: string;
  readonly input: unknown;
  readonly expected: Expected | null;
}

/**
 * One subject's case file, `cases/<group>/<id>.json`. `subject` is the file's
 * path under `cases/` without `.json` (`config/phax-config`).
 */
export interface CaseFile {
  readonly subject: string;
  readonly cases: ReadonlyArray<Case>;
}

/** Decodes one case's input as phax does: `subjects.ts` provides it. */
export type Replay = (subject: string, input: unknown) => Expected;

// ---------------------------------------------------------------------------
// Guards: parsed JSON read by hand, no assertion.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** An expectation: exactly `{ ok: true, value }` or `{ ok: false, refusal: string }`. */
function isExpected(value: unknown): value is Expected {
  if (!isRecord(value)) return false;
  if (value["ok"] === true) {
    return Object.hasOwn(value, "value") && hasOnlyKeys(value, ["ok", "value"]);
  }
  if (value["ok"] === false) {
    return typeof value["refusal"] === "string" && hasOnlyKeys(value, ["ok", "refusal"]);
  }
  return false;
}

function isCase(value: unknown): value is Case {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["name", "input", "expected"]) &&
    typeof value["name"] === "string" &&
    value["name"].length > 0 &&
    Object.hasOwn(value, "input") &&
    Object.hasOwn(value, "expected") &&
    (value["expected"] === null || isExpected(value["expected"]))
  );
}

/** A case file: `{ subject, cases }`, each case `{ name, input, expected }`, no other key. */
export function isCaseFile(value: unknown): value is CaseFile {
  if (!isRecord(value) || !hasOnlyKeys(value, ["subject", "cases"])) return false;
  const cases = value["cases"];
  return (
    typeof value["subject"] === "string" &&
    value["subject"].length > 0 &&
    Array.isArray(cases) &&
    cases.every(isCase)
  );
}

/** The case file a file's text holds; throws, naming `source`, when it is not one. */
export function parseCaseFile(text: string, source: string): CaseFile {
  const parsed: unknown = JSON.parse(text);
  if (!isCaseFile(parsed)) throw new Error(`${source}: not a corpus case file`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Canonical encoding.

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const ctor: unknown = Object.getPrototypeOf(value)?.constructor;
    return typeof ctor === "function" && ctor.name !== "" ? `a ${ctor.name} instance` : "an object";
  }
  if (typeof value === "number") return `the number ${String(value)}`;
  if (value === undefined) return "undefined";
  return `a ${typeof value}`;
}

function encodeAt(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: ${path}: ${describeValue(value)}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const [i, item] of value.entries()) {
      if (item === undefined)
        throw new Error(`canonicalJson: ${path}[${i}]: undefined in an array`);
      items.push(encodeAt(item, `${path}[${i}]`));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object" && isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${encodeAt(item, `${path}.${key}`)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`canonicalJson: ${path}: ${describeValue(value)} is not plain data`);
}

/**
 * One text per value, whatever its key order: object keys sorted, no
 * whitespace. Plain data only: null, booleans, strings, finite numbers, arrays
 * and plain objects (a key whose value is undefined is left out, as JSON
 * leaves it). Throws on anything else, a class instance, a bigint, a
 * non-finite number or undefined in an array, so a capture never stores a
 * value it cannot read back.
 */
export function canonicalJson(value: unknown): string {
  return encodeAt(value, "$");
}

// ---------------------------------------------------------------------------
// Capture.

export type CaptureOutcome =
  | { readonly kind: "captured"; readonly file: CaseFile; readonly filled: number }
  | { readonly kind: "refused"; readonly reason: string };

// An expectation as stored: plain JSON with its keys in canonical order.
function storedExpectation(expected: Expected): Expected {
  const stored: unknown = JSON.parse(canonicalJson(expected));
  if (!isExpected(stored)) throw new Error("captureFile: the replay answered no expectation");
  return stored;
}

/**
 * Fills every `expected: null` of `file` with what `replay` answers for its
 * input, and leaves every other expectation as it is. Refused unless
 * `effectMajor` is 3: the corpus records Effect 3's behaviour, never a later
 * one's. Throws when a replay answers a value that is not plain data.
 */
export function captureFile(file: CaseFile, replay: Replay, effectMajor: number): CaptureOutcome {
  if (effectMajor !== 3) {
    return {
      kind: "refused",
      reason: `the corpus is captured on Effect 3 only; the installed effect major is ${String(effectMajor)}`,
    };
  }
  let filled = 0;
  const cases = file.cases.map((c): Case => {
    if (c.expected !== null) return c;
    filled += 1;
    return {
      name: c.name,
      input: c.input,
      expected: storedExpectation(replay(file.subject, c.input)),
    };
  });
  return { kind: "captured", file: { subject: file.subject, cases }, filled };
}

/** A case file's text as the capture script writes it. */
export function caseFileText(file: CaseFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Case files on disk.

/** Every `*.json` under `root`, recursively, sorted, as absolute paths. */
export function listCaseFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) found.push(path);
    }
  };
  walk(root);
  return found.toSorted();
}

/** The subject a case file must name: its path under `root`, POSIX, without `.json`. */
export function subjectOfPath(root: string, path: string): string {
  return relative(root, path)
    .split(sep)
    .join("/")
    .replace(/\.json$/, "");
}

// ---------------------------------------------------------------------------
// Input envelopes.

/**
 * The input of a subject that covers several decoders: which one, and the
 * input it is given.
 */
export interface DecoderInput {
  readonly decoder: string;
  readonly raw: unknown;
}

export function readDecoderInput(input: unknown): DecoderInput {
  if (!isRecord(input) || !hasOnlyKeys(input, ["decoder", "raw"])) {
    throw new Error("corpus input: expected { decoder, raw }");
  }
  const decoder = input["decoder"];
  if (typeof decoder !== "string" || !Object.hasOwn(input, "raw")) {
    throw new Error("corpus input: expected { decoder, raw }");
  }
  return { decoder, raw: input["raw"] };
}

/**
 * A provider stream's lines. A string entry is the line as it is (not JSON,
 * blank, anything); any other entry is the JSON text of that value, so an event
 * reads as an object in the case file.
 */
export function streamLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("corpus input: expected an array of stream lines");
  return raw.map((line: unknown) => (typeof line === "string" ? line : JSON.stringify(line)));
}

/** A document's text: a string as it is, any other value as its JSON text. */
export function documentText(raw: unknown): string {
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

/** The input of `config/vibe-config`: a config.toml's text and the alias of its base model. */
export interface TomlInput {
  readonly toml: string;
  readonly alias: string;
}

export function readTomlInput(input: unknown): TomlInput {
  if (!isRecord(input) || !hasOnlyKeys(input, ["toml", "alias"])) {
    throw new Error("corpus input: expected { toml, alias }");
  }
  const toml = input["toml"];
  const alias = input["alias"];
  if (typeof toml !== "string" || typeof alias !== "string") {
    throw new Error("corpus input: expected { toml, alias } strings");
  }
  return { toml, alias };
}
