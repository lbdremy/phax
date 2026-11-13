// The behaviour corpus: case files whose expectations were captured on Effect 3
// during the Effect 4 migration, replayed on every later tree. This module is
// Effect-free: it holds the case-file shape and its guard, the input envelopes a
// subject reads, the canonical encoder both sides of a comparison go through,
// and `captureFile`, which fills only the expectations still null and refuses
// any effect major but 3. No script calls it any more (see CONTRIBUTING.md, "The
// behaviour corpus"). `subjects.ts` is the one corpus module that touches Effect.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * What one case decodes to: the decoded value as plain data, or the refusal line
 * phax prints. A format's parse function also names the `shape` it read.
 */
export type Expected =
  | { readonly ok: true; readonly value: unknown; readonly shape?: string }
  | { readonly ok: false; readonly refusal: string };

/** One input of a subject. `expected` is null until a capture fills it. */
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

/**
 * One persisted format's case file, `cases/formats/<format-id>.json`: `current`
 * replays through the schemas package's parse function for the format
 * (subject `format:<id>`), and each `shapes[<shape>]` list through that frozen
 * module's decoder (subject `frozen:<id>/<shape>`).
 */
export interface FormatCaseFile {
  readonly format: string;
  readonly current: ReadonlyArray<Case>;
  readonly shapes: Readonly<Record<string, ReadonlyArray<Case>>>;
}

/** A case file as stored: a subject's, or a format's. */
export type CorpusFile = CaseFile | FormatCaseFile;

/**
 * What a captured refusal writes where it names the running schemas package's
 * version (`… is newer than @lbdremy/phax-schemas {package-version}`): every
 * release opening changes that version, so the case file names none.
 */
const PACKAGE_VERSION_TOKEN = "{package-version}";

/**
 * The shape a format's parse function names when its `next` snapshot reads the
 * document: one stamped with the opened release, not cut yet. The cut renames
 * that snapshot to the release, and from then on, on every later tree, the same
 * document reads as that release's shape, so a case file writes `next` and
 * names no release.
 */
const NEXT_SHAPE = "next";

/** What a replay depends on besides its input: the tree's schemas package version and release ledger. */
export interface ReplayTree {
  /** The schemas package version the tree runs (`PACKAGE_VERSION`). */
  readonly packageVersion: string;
  /** The releases of packages/schemas/releases.json, the cut ones. */
  readonly releases: ReadonlyArray<string>;
}

/** The release a document's `$schema` names (`…/<format-id>/<X.Y.Z>.json`), if it names one. */
function schemaRelease(document: unknown): string | undefined {
  if (!isRecord(document)) return undefined;
  const url = document["$schema"];
  if (typeof url !== "string") return undefined;
  return /\/(\d+\.\d+\.\d+)\.json$/.exec(url)?.[1];
}

/**
 * The shape a captured `shape` names for `document` on a tree whose ledger
 * lists `releases`: `next` until the release the document's `$schema` names is
 * cut, that release after; any other shape as it is.
 */
export function shapeAt(
  shape: string | undefined,
  document: unknown,
  releases: ReadonlyArray<string>,
): string | undefined {
  if (shape !== NEXT_SHAPE) return shape;
  const release = schemaRelease(document);
  return release !== undefined && releases.includes(release) ? release : shape;
}

/**
 * `expected` for `document` as `tree` answers it: a refusal names the tree's
 * package version, and an accepted `next` shape the release that cut it (see
 * `shapeAt`).
 */
export function expectedAt(expected: Expected, tree: ReplayTree, document: unknown): Expected {
  if (expected.ok) {
    const shape = shapeAt(expected.shape, document, tree.releases);
    return shape === undefined || shape === expected.shape ? expected : { ...expected, shape };
  }
  return {
    ok: false,
    refusal: expected.refusal.replaceAll(PACKAGE_VERSION_TOKEN, tree.packageVersion),
  };
}

/** The releases a release ledger's text lists (`{ "releases": [<X.Y.Z>, …] }`); throws, naming `source`, on any other text. */
export function parseReleaseLedger(text: string, source: string): string[] {
  const parsed: unknown = JSON.parse(text);
  const releases = isRecord(parsed) ? parsed["releases"] : undefined;
  if (
    !Array.isArray(releases) ||
    !releases.every((release) => typeof release === "string" && /^\d+\.\d+\.\d+$/.test(release))
  ) {
    throw new Error(`${source}: not a release ledger`);
  }
  return releases;
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

/**
 * An expectation: `{ ok: true, value }` (with a string `shape` for a format's
 * parse function) or `{ ok: false, refusal: string }`.
 */
function isExpected(value: unknown): value is Expected {
  if (!isRecord(value)) return false;
  if (value["ok"] === true) {
    return (
      Object.hasOwn(value, "value") &&
      hasOnlyKeys(value, ["ok", "value", "shape"]) &&
      (!Object.hasOwn(value, "shape") || typeof value["shape"] === "string")
    );
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

/** A format case file: `{ format, current, shapes }`, every case `{ name, input, expected }`. */
function isFormatCaseFile(value: unknown): value is FormatCaseFile {
  if (!isRecord(value) || !hasOnlyKeys(value, ["format", "current", "shapes"])) return false;
  const { format, current, shapes } = value;
  return (
    typeof format === "string" &&
    format.length > 0 &&
    Array.isArray(current) &&
    current.every(isCase) &&
    isRecord(shapes) &&
    Object.values(shapes).every((cases) => Array.isArray(cases) && cases.every(isCase))
  );
}

/** The case file (a subject's or a format's) a file's text holds; throws, naming `source`, when it is neither. */
export function parseCorpusFile(text: string, source: string): CorpusFile {
  const parsed: unknown = JSON.parse(text);
  if (isCaseFile(parsed) || isFormatCaseFile(parsed)) return parsed;
  throw new Error(`${source}: not a corpus case file`);
}

/**
 * The input of a flattened format case: which subject (`format:<id>` or
 * `frozen:<id>/<shape>`) decodes `document`.
 */
export interface TargetInput {
  readonly target: string;
  readonly document: unknown;
}

export function readTargetInput(input: unknown): TargetInput {
  if (!isRecord(input) || !hasOnlyKeys(input, ["target", "document"])) {
    throw new Error("corpus input: expected { target, document }");
  }
  const target = input["target"];
  if (typeof target !== "string" || !Object.hasOwn(input, "document")) {
    throw new Error("corpus input: expected { target, document }");
  }
  return { target, document: input["document"] };
}

/**
 * A format case file as a subject case file, so a walk that knows only
 * `{ subject, cases }` replays it: subject `formats/<id>`, the current cases
 * named `current <name>` and each frozen shape's `<shape> <name>`, every input
 * wrapped as a `TargetInput`.
 */
function targeted(target: string, label: string, list: ReadonlyArray<Case>): Case[] {
  return list.map((c) => ({
    name: `${label} ${c.name}`,
    input: { target, document: c.input },
    expected: c.expected,
  }));
}

function flattenFormatFile(file: FormatCaseFile): CaseFile {
  return {
    subject: `formats/${file.format}`,
    cases: [
      ...targeted(`format:${file.format}`, "current", file.current),
      ...Object.entries(file.shapes).flatMap(([shape, list]) =>
        targeted(`frozen:${file.format}/${shape}`, shape, list),
      ),
    ],
  };
}

/**
 * The case file a file's text holds, as subject cases (a format's flattened);
 * throws, naming `source`, when it is not one.
 */
export function parseCaseFile(text: string, source: string): CaseFile {
  const parsed = parseCorpusFile(text, source);
  return "format" in parsed ? flattenFormatFile(parsed) : parsed;
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
  if (effectMajor !== 3) return refusedOutcome(effectMajor);
  const { cases, filled } = fillCases(file.cases, (input) => replay(file.subject, input));
  return { kind: "captured", file: { subject: file.subject, cases }, filled };
}

function refusedOutcome(effectMajor: number): {
  readonly kind: "refused";
  readonly reason: string;
} {
  return {
    kind: "refused",
    reason: `the corpus is captured on Effect 3 only; the installed effect major is ${String(effectMajor)}`,
  };
}

function fillCases(
  list: ReadonlyArray<Case>,
  decode: (input: unknown) => Expected,
): { readonly cases: Case[]; readonly filled: number } {
  let filled = 0;
  const cases = list.map((c): Case => {
    if (c.expected !== null) return c;
    filled += 1;
    return { name: c.name, input: c.input, expected: storedExpectation(decode(c.input)) };
  });
  return { cases, filled };
}

export type CorpusCaptureOutcome =
  | { readonly kind: "captured"; readonly file: CorpusFile; readonly filled: number }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * `captureFile` for either kind of file. A format file's current cases are
 * filled through `format:<id>` and each frozen shape's through
 * `frozen:<id>/<shape>`.
 */
export function captureCorpusFile(
  file: CorpusFile,
  replay: Replay,
  effectMajor: number,
): CorpusCaptureOutcome {
  if (!("format" in file)) return captureFile(file, replay, effectMajor);
  if (effectMajor !== 3) return refusedOutcome(effectMajor);
  let filled = 0;
  const fill = (subject: string, list: ReadonlyArray<Case>): Case[] => {
    const result = fillCases(list, (input) => replay(subject, input));
    filled += result.filled;
    return result.cases;
  };
  const current = fill(`format:${file.format}`, file.current);
  const shapes = Object.fromEntries(
    Object.entries(file.shapes).map(([shape, list]) => [
      shape,
      fill(`frozen:${file.format}/${shape}`, list),
    ]),
  );
  return { kind: "captured", file: { format: file.format, current, shapes }, filled };
}

/** A case file's text as a capture writes it. */
export function caseFileText(file: CorpusFile): string {
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
