// Hand-written JSON generators for the persisted-format properties: any JSON, an object carrying
// a format's `$schema` (well-formed or not), a valid document with one key removed or retyped, and
// a document stamped above a running release. They keep fast-check's own shrinking, unlike the
// schema-derived generators of formatRegistry.ts.
import * as fc from "fast-check";
import {
  FORMAT_IDS,
  SCHEMA_URL_BASE,
  schemaUrl,
  type FormatId,
} from "../../../src/schemas/schemaUrl.js";
import type { FormatEntry } from "./formatRegistry.js";

type Document = Readonly<Record<string, unknown>>;

const MAX_DEPTH = 6;

// fast-check builds an object with a null prototype; JSON.parse, where every reader's input comes
// from, builds an ordinary one. Rebuilt with Object.fromEntries, so a `__proto__` key stays an own
// key, as JSON.parse leaves it.
const plain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
};

const json = (maxDepth: number): fc.Arbitrary<unknown> => fc.jsonValue({ maxDepth }).map(plain);

const dictionary = (
  keys: fc.Arbitrary<string>,
  maxKeys: number,
  maxDepth: number,
): fc.Arbitrary<Document> =>
  fc.dictionary(keys, json(maxDepth), { maxKeys }).map((value) => plain(value) as Document);

/** Any JSON value, nested up to six levels. */
export const anyJson = (): fc.Arbitrary<unknown> => json(MAX_DEPTH);

// Entries of an arbitrary JSON object, shallower than anyJson so a stamped object stays small.
const entries = (): fc.Arbitrary<Document> => dictionary(fc.string({ maxLength: 12 }), 6, 3);

const releaseTriple = (): fc.Arbitrary<string> =>
  fc.tuple(fc.nat(60), fc.nat(60), fc.nat(60)).map(([x, y, z]) => `${x}.${y}.${z}`);

// The `$schema` values a stamped object carries, each a way the stamp can be right or wrong.
const stampValue = (id: FormatId): fc.Arbitrary<unknown> => {
  const otherIds = FORMAT_IDS.filter((other) => other !== id);
  return fc.oneof(
    // the format's URL at an arbitrary release
    releaseTriple().map((release) => schemaUrl(id, release)),
    // another format id
    fc
      .tuple(fc.constantFrom(...otherIds), releaseTriple())
      .map(([other, release]) => schemaUrl(other, release)),
    // an unknown format id
    fc
      .tuple(fc.constantFrom("unknown-format", "made-up", "x1-y2"), releaseTriple())
      .map(([other, release]) => `${SCHEMA_URL_BASE}/${other}/${release}.json`),
    // a release that is not X.Y.Z
    fc.constantFrom("1.2", "01.2.3", "1.2.3-rc.1").map((release) => schemaUrl(id, release)),
    // a missing `.json`
    releaseTriple().map((release) => `${SCHEMA_URL_BASE}/${id}/${release}`),
    // another base URL
    releaseTriple().map((release) => `https://example.com/schemas/${id}/${release}.json`),
    // a non-string value
    fc.oneof(
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.constant([]),
      fc.constant({}),
      fc.constant({ id }),
    ),
  );
};

/** An object of arbitrary JSON entries whose `$schema` is `id`'s URL at some release, or a malformed stamp. */
export const stampedObject = (id: FormatId): fc.Arbitrary<Document> =>
  fc
    .tuple(entries(), stampValue(id))
    .map(([body, stamp]): Document => ({ ...body, $schema: stamp }));

// ── mutations ───────────────────────────────────────────────────────────────

type PathStep = string | number;

/** One valid document with exactly one key removed or one value retyped. */
interface Mutation {
  readonly source: unknown;
  readonly mutated: unknown;
  /** Where in the object tree `mutated` differs from `source`. */
  readonly path: ReadonlyArray<PathStep>;
  readonly kind: "remove" | "replace";
}

type JsonType = "null" | "boolean" | "number" | "string" | "array" | "object";

const JSON_TYPES: ReadonlyArray<JsonType> = [
  "null",
  "boolean",
  "number",
  "string",
  "array",
  "object",
];

const jsonTypeOf = (value: unknown): JsonType => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "boolean" || type === "number" || type === "string" ? type : "object";
};

const isObject = (value: unknown): value is Document =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Site {
  readonly path: ReadonlyArray<PathStep>;
  readonly removable: boolean;
}

// Every key and array element below the root.
const sites = (value: unknown, path: ReadonlyArray<PathStep> = []): ReadonlyArray<Site> => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => [
      { path: [...path, index], removable: false },
      ...sites(item, [...path, index]),
    ]);
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => [
      { path: [...path, key], removable: true },
      ...sites(item, [...path, key]),
    ]);
  }
  return [];
};

const at = (value: unknown, path: ReadonlyArray<PathStep>): unknown =>
  path.reduce<unknown>((node, step) => (node as Record<PathStep, unknown>)[step], value);

// A copy of `value` with `path` removed (`replacement` omitted) or replaced.
const rewrite = (
  value: unknown,
  path: ReadonlyArray<PathStep>,
  replacement: { readonly value: unknown } | undefined,
): unknown => {
  const [step, ...rest] = path;
  if (step === undefined) return replacement?.value;
  if (Array.isArray(value)) {
    return value.map((item, index) => (index === step ? rewrite(item, rest, replacement) : item));
  }
  const pairs = Object.entries(value as Document).flatMap(
    ([key, item]): Array<[string, unknown]> => {
      if (key !== step) return [[key, item]];
      if (rest.length === 0 && replacement === undefined) return [];
      return [[key, rewrite(item, rest, replacement)]];
    },
  );
  return Object.fromEntries(pairs);
};

const replacements = (): fc.Arbitrary<Readonly<Record<JsonType, unknown>>> =>
  fc.record({
    null: fc.constant(null),
    boolean: fc.boolean(),
    number: fc.integer(),
    string: fc.string({ maxLength: 12 }),
    array: fc.array(json(1), { maxLength: 2 }),
    object: dictionary(fc.string({ maxLength: 6 }), 2, 1),
  });

/**
 * The written encoding of a valid value of `entry`, with exactly one key removed or one value
 * replaced by a JSON value of another type, at a generated path (nested objects and array
 * elements included).
 */
export const mutations = (entry: FormatEntry): fc.Arbitrary<Mutation> =>
  fc
    .record({
      value: entry.valid(),
      pick: fc.nat(),
      remove: fc.boolean(),
      typePick: fc.nat(),
      replacement: replacements(),
    })
    .map(({ value, pick, remove, typePick, replacement }): Mutation => {
      const source = entry.write(value);
      const all = sites(source);
      const removable = all.filter((site) => site.removable);
      const kind = remove && removable.length > 0 ? "remove" : "replace";
      const pool = kind === "remove" ? removable : all;
      const site = pool[pick % pool.length];
      if (site === undefined) return { source, mutated: source, path: [], kind };
      if (kind === "remove") {
        return { source, mutated: rewrite(source, site.path, undefined), path: site.path, kind };
      }
      const original = jsonTypeOf(at(source, site.path));
      const others = JSON_TYPES.filter((type) => type !== original);
      const type = others[typePick % others.length] ?? "null";
      return {
        source,
        mutated: rewrite(source, site.path, { value: replacement[type] }),
        path: site.path,
        kind,
      };
    });

/** A valid document of `entry`, written, with exactly one key removed or retyped. */
export const mutatedValid = (entry: FormatEntry): fc.Arbitrary<unknown> =>
  mutations(entry).map((mutation) => mutation.mutated);

// ── newer stamps ────────────────────────────────────────────────────────────

type BumpStep = "patch" | "minor" | "major";

/** A document stamped one step above the running release. */
interface NewerStamped {
  readonly release: string;
  readonly step: BumpStep;
  readonly document: Document;
}

const bump = (running: string, step: BumpStep): string => {
  const [x = 0, y = 0, z = 0] = running.split(".").map(Number);
  if (step === "major") return `${x + 1}.0.0`;
  if (step === "minor") return `${x}.${y + 1}.0`;
  return `${x}.${y}.${z + 1}`;
};

/**
 * `id`'s URL at one patch, one minor or one major above `running`, over `body`'s entries (a
 * `$schema` entry of the body is replaced by the stamp).
 */
export const newerStamped = (
  id: FormatId,
  running: string,
  body: fc.Arbitrary<Document>,
): fc.Arbitrary<NewerStamped> =>
  fc
    .tuple(fc.constantFrom<BumpStep>("patch", "minor", "major"), body)
    .map(([step, entriesOfBody]) => {
      const release = bump(running, step);
      const { $schema: _dropped, ...rest } = entriesOfBody;
      return { release, step, document: { $schema: schemaUrl(id, release), ...rest } };
    });

/** What a newer-stamped document holds: the written encoding of a valid value, or arbitrary entries. */
export const newerBody = (entry: FormatEntry): fc.Arbitrary<Document> =>
  fc.oneof(
    entry.valid().map((value) => {
      const { $schema: _schema, ...rest } = entry.write(value) as Document;
      return rest;
    }),
    entries(),
  );
