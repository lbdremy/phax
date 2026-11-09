// Densifies the behaviour corpus without Effect: it appends the cases the coverage test
// (tests/unit/effect4Corpus/coverage.test.ts) asks for, each with `expected: null`, and
// the capture script fills them on Effect 3.
//
// - One refused-case candidate per constraint of a format's latest snapshot (its
//   `current` list) and of each frozen shape's snapshot (its `shapes[<shape>]` list),
//   named `constraint <path> <keyword>`. It copies an accepted case of the same list
//   whose input sets the path and mutates exactly that leaf. When no accepted case sets
//   the path it says so and invents nothing.
// - For every written format with no `cases/encode/<id>.json`, that file: one case per
//   accepted current case of the latest shape, with the same name and input.
//
// An existing case is never changed or removed, and a second run changes nothing. A new
// constraint case that captures as accepted (another union branch took the mutated value)
// is repaired by hand: see the report's note.
// Imports only corpus.ts and node built-ins.
// Run: pnpm exec tsx scripts/effect4-corpus-densify.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  caseFileText,
  parseCorpusFile,
  type CaseFile,
  type FormatCaseFile,
} from "../tests/effect4Corpus/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const formatsRoot = join(root, "tests", "effect4Corpus", "cases", "formats");
const encodeRoot = join(root, "tests", "effect4Corpus", "cases", "encode");
const snapshotsRoot = join(root, "packages", "schemas", "snapshots");

type JsonObject = Readonly<Record<string, unknown>>;
type Step = string | number;
type CaseList = FormatCaseFile["current"];
type NewCase = CaseList[number];

// The formats phax writes through a `Schema.encode*` writer; the same list as the
// coverage test's WRITTEN_FORMATS (which says why the others are left out).
const WRITTEN_FORMATS = [
  "registry",
  "run-status",
  "phase-status",
  "phax-plan",
  "compliance-review",
  "plan-approvals",
  "spec-approvals",
  "phase-record-manifest",
  "authoring-record-manifest",
  "gate-attribution",
  "phase-file-reconciliation",
  "spec-document",
  "plan-document",
  "plan-approval-record",
  "spec-approval-record",
  "gate-request",
  "brief-request",
  "brief-record",
  "decision-record-manifest",
  "first-reading",
  "interactive-handoff",
  "interactive-session",
  "review-stop",
  "run-list",
  "review-record-manifest",
  "code-review",
  "phax-plan-extraction",
  "acceptance-request",
  "artifact-status",
  "plan-overview",
  "plan-lint",
];

const CONSTRAINT_KEYWORDS = ["pattern", "minLength", "maxLength", "minItems", "enum", "const"];

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNodes(value: unknown): JsonObject[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(isRecord);
}

function child(prefix: string, key: string): string {
  return prefix === "" ? key : `${prefix}.${key}`;
}

// ---------------------------------------------------------------------------
// The constraints of a snapshot: the coverage test's walk, keeping each keyword's values.

interface Constraint {
  readonly path: string;
  readonly keyword: string;
  readonly values: unknown[];
}

function constraintsOf(schema: JsonObject): Constraint[] {
  const defs = isRecord(schema["$defs"]) ? schema["$defs"] : {};
  const found = new Map<string, Constraint>();
  const add = (path: string, keyword: string, value: unknown): void => {
    const key = `${path}\u0000${keyword}`;
    const known = found.get(key);
    if (known === undefined) found.set(key, { path, keyword, values: [value] });
    else known.values.push(value);
  };
  const walk = (node: JsonObject, prefix: string, refs: ReadonlyArray<string>): void => {
    const ref = node["$ref"];
    if (typeof ref === "string") {
      const name = ref.replace("#/$defs/", "");
      const target = defs[name];
      if (!refs.includes(name) && isRecord(target)) walk(target, prefix, [...refs, name]);
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      for (const branch of asNodes(node[key])) walk(branch, prefix, refs);
    }
    for (const keyword of CONSTRAINT_KEYWORDS) {
      if (node[keyword] !== undefined && prefix !== "") add(prefix, keyword, node[keyword]);
    }
    if (Array.isArray(node["required"])) {
      for (const key of node["required"]) {
        if (typeof key === "string") add(child(prefix, key), "required", true);
      }
    }
    const properties = node["properties"];
    if (isRecord(properties)) {
      for (const [key, sub] of Object.entries(properties)) {
        for (const subNode of asNodes(sub)) walk(subNode, child(prefix, key), refs);
      }
    }
    const records: unknown[] = [];
    const additional = node["additionalProperties"];
    if (isRecord(additional)) records.push(additional);
    const patterned = node["patternProperties"];
    if (isRecord(patterned)) records.push(...Object.values(patterned));
    for (const sub of records) {
      for (const subNode of asNodes(sub)) walk(subNode, child(prefix, "*"), refs);
    }
    if (node["items"] !== undefined) {
      for (const subNode of asNodes(node["items"])) walk(subNode, `${prefix}[]`, refs);
    }
  };
  walk(schema, "", []);
  return [...found.values()].toSorted(
    (a, b) => a.path.localeCompare(b.path) || a.keyword.localeCompare(b.keyword),
  );
}

function caseName(c: Constraint): string {
  return `constraint ${c.path} ${c.keyword}`;
}

// ---------------------------------------------------------------------------
// Finding a path in a document, and mutating the leaf.

// `a.b[].c.*` as steps: a key, `[]` (items of an array) or `*` (values of a record).
function segmentsOf(path: string): string[] {
  return path.split(".").flatMap((part) => {
    const items = /(\[\])+$/.exec(part)?.[0] ?? "";
    const key = part.slice(0, part.length - items.length);
    return [...(key === "" ? [] : [key]), ...Array.from({ length: items.length / 2 }, () => "[]")];
  });
}

/** The steps to the first value at `segments` in `value` (depth first) that `accept`s. */
function locate(
  value: unknown,
  segments: ReadonlyArray<string>,
  accept: (leaf: unknown) => boolean,
): Step[] | undefined {
  const [head, ...rest] = segments;
  if (head === undefined) return accept(value) ? [] : undefined;
  if (head === "[]") {
    if (!Array.isArray(value)) return undefined;
    for (const [i, item] of value.entries()) {
      const found = locate(item, rest, accept);
      if (found !== undefined) return [i, ...found];
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (head === "*") {
    for (const [key, item] of Object.entries(value)) {
      const found = locate(item, rest, accept);
      if (found !== undefined) return [key, ...found];
    }
    return undefined;
  }
  if (!Object.hasOwn(value, head) || value[head] === undefined) return undefined;
  const found = locate(value[head], rest, accept);
  return found === undefined ? undefined : [head, ...found];
}

function at(value: unknown, steps: ReadonlyArray<Step>): unknown {
  let current = value;
  for (const step of steps) {
    current = (current as Record<Step, unknown>)[step];
  }
  return current;
}

function stringValues(values: ReadonlyArray<unknown>): string[] {
  return values.filter((v): v is string => typeof v === "string");
}

function numberValues(values: ReadonlyArray<unknown>): number[] {
  return values.filter((v): v is number => typeof v === "number");
}

function regexOf(pattern: string): RegExp | undefined {
  for (const flags of ["u", ""]) {
    try {
      return new RegExp(pattern, flags);
    } catch {
      // try the next flag set
    }
  }
  return undefined;
}

/**
 * A string the patterns refuse: the first of the candidates every pattern refuses, else the
 * first any pattern refuses (a leaf whose patterns are stacked refuses a value that breaks one).
 */
function refusedByPattern(patterns: ReadonlyArray<string>): string | undefined {
  const regexes = patterns.map(regexOf).filter((r): r is RegExp => r !== undefined);
  if (regexes.length === 0) return undefined;
  const candidates = ["", " ", "bogus value", "!"];
  return (
    candidates.find((c) => regexes.every((r) => !r.test(c))) ??
    candidates.find((c) => regexes.some((r) => !r.test(c)))
  );
}

function otherThan(values: ReadonlyArray<unknown>): string {
  return values.includes("bogus-value") ? "bogus-value-2" : "bogus-value";
}

const STRING_KEYWORDS = ["pattern", "minLength", "maxLength"];

/** The mutated leaf for the constraint, or `undefined` when it cannot be mutated. */
function mutated(constraint: Constraint, leaf: unknown): { readonly value: unknown } | undefined {
  const { keyword, values } = constraint;
  switch (keyword) {
    case "pattern": {
      const value = refusedByPattern(stringValues(values));
      return value === undefined ? undefined : { value };
    }
    case "minLength": {
      const n = Math.max(...numberValues(values));
      const base = typeof leaf === "string" ? leaf : "";
      return { value: base.length >= n ? base.slice(0, Math.max(n - 1, 0)) : "a".repeat(n - 1) };
    }
    case "maxLength": {
      const n = Math.min(...numberValues(values));
      const base = typeof leaf === "string" ? leaf : "";
      return { value: base.length > n ? base.slice(0, n + 1) : base.padEnd(n + 1, "a") };
    }
    case "minItems": {
      const n = Math.max(...numberValues(values));
      return Array.isArray(leaf) ? { value: leaf.slice(0, Math.max(n - 1, 0)) } : undefined;
    }
    case "enum":
      return { value: otherThan(values.flatMap((v) => (Array.isArray(v) ? v : [v]))) };
    case "const":
      return { value: otherThan(values) };
    default:
      return undefined;
  }
}

/** The new case for the constraint, copied from the first accepted case that sets its path. */
function constraintCase(
  constraint: Constraint,
  list: CaseList,
): { readonly made: NewCase } | { readonly missing: string } {
  const segments = segmentsOf(constraint.path);
  const accepted = list.filter((c) => c.expected?.ok === true);
  const wantsString = STRING_KEYWORDS.includes(constraint.keyword);
  const wantsArray = constraint.keyword === "minItems";
  const typed = (leaf: unknown): boolean =>
    wantsString ? typeof leaf === "string" : wantsArray ? Array.isArray(leaf) : true;
  for (const accept of [typed, (): boolean => true]) {
    for (const source of accepted) {
      const steps = locate(source.input, segments, accept);
      if (steps === undefined) continue;
      const input = structuredClone(source.input);
      const parent = at(input, steps.slice(0, -1)) as Record<Step, unknown>;
      const last = steps.at(-1);
      if (last === undefined) continue;
      if (constraint.keyword === "required") {
        delete parent[last];
      } else {
        const change = mutated(constraint, parent[last]);
        if (change === undefined) continue;
        parent[last] = change.value;
      }
      return { made: { name: caseName(constraint), input, expected: null } };
    }
  }
  return { missing: `no accepted case sets ${constraint.path} (${constraint.keyword})` };
}

// ---------------------------------------------------------------------------
// Files.

function compareReleases(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function latestRelease(id: string): string {
  const release = readdirSync(join(snapshotsRoot, id))
    .map((name) => name.replace(/\.schema\.json$/, ""))
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .toSorted(compareReleases)
    .at(-1);
  if (release === undefined) throw new Error(`no released snapshot for ${id}`);
  return release;
}

function readSnapshot(id: string, shape: string): JsonObject {
  const path = join(snapshotsRoot, id, `${shape}.schema.json`);
  if (!existsSync(path)) throw new Error(`${id}/${shape}: no snapshot at ${path}`);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${id}/${shape}: snapshot is not an object`);
  return parsed;
}

interface Tally {
  added: number;
  files: number;
  problems: string[];
}

/** The list with the missing constraint cases appended, and the count of cases added. */
function densified(
  label: string,
  list: CaseList,
  snapshot: JsonObject,
  tally: Tally,
): { readonly list: CaseList; readonly added: number } {
  const names = new Set(list.map((c) => c.name));
  const made: NewCase[] = [];
  for (const constraint of constraintsOf(snapshot)) {
    if (names.has(caseName(constraint))) continue;
    const result = constraintCase(constraint, list);
    if ("made" in result) made.push(result.made);
    else tally.problems.push(`${label}: ${result.missing}`);
  }
  tally.added += made.length;
  if (made.length > 0) process.stdout.write(`  ${label}: ${made.length} constraint cases\n`);
  return { list: [...list, ...made], added: made.length };
}

function densifyFormats(tally: Tally): void {
  for (const name of readdirSync(formatsRoot).toSorted()) {
    if (!name.endsWith(".json")) continue;
    const path = join(formatsRoot, name);
    const file = parseCorpusFile(readFileSync(path, "utf8"), path);
    if (!("format" in file)) throw new Error(`${path}: not a format case file`);
    const id = file.format;
    let added = 0;
    const current = densified(
      `${id} current`,
      file.current,
      readSnapshot(id, latestRelease(id)),
      tally,
    );
    added += current.added;
    const shapes: Record<string, CaseList> = {};
    for (const [shape, list] of Object.entries(file.shapes)) {
      const result = densified(`${id} ${shape}`, list, readSnapshot(id, shape), tally);
      shapes[shape] = result.list;
      added += result.added;
    }
    if (added === 0) continue;
    const next: FormatCaseFile = { format: id, current: current.list, shapes };
    writeFileSync(path, caseFileText(next));
    tally.files += 1;
  }
}

function writeEncodeFiles(tally: Tally): void {
  mkdirSync(encodeRoot, { recursive: true });
  for (const id of WRITTEN_FORMATS) {
    const path = join(encodeRoot, `${id}.json`);
    if (existsSync(path)) continue;
    const source = join(formatsRoot, `${id}.json`);
    const file = parseCorpusFile(readFileSync(source, "utf8"), source);
    if (!("format" in file)) throw new Error(`${source}: not a format case file`);
    const release = latestRelease(id);
    const cases = file.current
      .filter((c) => c.expected?.ok === true && c.expected.shape === release)
      .map((c): NewCase => ({ name: c.name, input: c.input, expected: null }));
    if (cases.length === 0) {
      tally.problems.push(`${id}: no accepted current case of the latest shape ${release}`);
      continue;
    }
    const encoded: CaseFile = { subject: `encode/${id}`, cases };
    writeFileSync(path, caseFileText(encoded));
    process.stdout.write(`  encode/${id}: ${cases.length} cases\n`);
    tally.files += 1;
  }
}

function main(): number {
  const tally: Tally = { added: 0, files: 0, problems: [] };
  densifyFormats(tally);
  writeEncodeFiles(tally);
  process.stdout.write(
    `effect4-corpus-densify: ${tally.added} constraint cases appended, ${tally.files} files written\n`,
  );
  for (const problem of tally.problems) process.stdout.write(`  not resolved: ${problem}\n`);
  process.stdout.write(
    "Next: pnpm exec tsx scripts/effect4-corpus-capture.ts, then repair by hand each new constraint case that captured ok: true.\n",
  );
  return 0;
}

process.exitCode = main();
