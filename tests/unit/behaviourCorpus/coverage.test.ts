// What the behaviour corpus must cover before the Effect 4 migration may rely on it:
// every persisted format has a case file; the accepted documents of its current shape
// together set every property path of its latest released JSON Schema (the later
// equivalence check compares Effect 4's generated schema with these snapshots, and a
// field no accepted document sets would be compared with nothing); every format has a
// refused current case; every frozen decoder has an accepted and a refused case.
// Effect-free: it imports nothing from `effect`, directly or through the corpus,
// so it reads the format ids from the source of `schemaUrl.ts` rather than importing them.
//
// Path notation, one string per declared property: `a.b` for a property, `a[]` for the
// items of an array, `a.*` for the values of a record (`additionalProperties` or
// `patternProperties` holding a schema). `$ref` is followed into `$defs` with a cycle
// guard, and the branches of `anyOf`, `oneOf` and `allOf` all count. A document sets a
// path when it holds a value there: a key present, an array with an element, a record
// with an entry.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseCorpusFile,
  type CorpusFile,
  type FormatCaseFile,
} from "../../behaviourCorpus/corpus.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const formatsRoot = `${repoRoot}tests/behaviourCorpus/cases/formats/`;
const snapshotsRoot = `${repoRoot}packages/schemas/snapshots/`;

type JsonObject = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The ids of `FORMAT_IDS`, read from its source: this file imports no Effect module. */
function formatIds(): string[] {
  const source = readFileSync(`${repoRoot}src/schemas/schemaUrl.ts`, "utf8");
  const list = /export const FORMAT_IDS = \[([^\]]*)\] as const;/.exec(source)?.[1];
  if (list === undefined) throw new Error("schemaUrl.ts: FORMAT_IDS list not found");
  return [...list.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1] ?? "");
}

/** The frozen modules of packages/schemas/history.lock.json, as `<format-id>/<shape>`. */
function frozenModules(): string[] {
  const lock: unknown = JSON.parse(
    readFileSync(`${repoRoot}packages/schemas/history.lock.json`, "utf8"),
  );
  if (!isRecord(lock)) throw new Error("history.lock.json: not an object");
  return Object.keys(lock).map((path) => {
    const match = /^src\/schemas\/history\/([a-z0-9-]+)\/([^/]+)\.ts$/.exec(path);
    if (match === null) throw new Error(`history.lock.json: unexpected path ${path}`);
    return `${match[1] ?? ""}/${match[2] ?? ""}`;
  });
}

function compareReleases(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The highest release a format has a snapshot for. */
function latestRelease(id: string): string {
  const release = readdirSync(`${snapshotsRoot}${id}`)
    .map((name) => name.replace(/\.schema\.json$/, ""))
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .toSorted(compareReleases)
    .at(-1);
  if (release === undefined) throw new Error(`no released snapshot for ${id}`);
  return release;
}

function readSnapshot(id: string, release: string): JsonObject {
  const parsed: unknown = JSON.parse(
    readFileSync(`${snapshotsRoot}${id}/${release}.schema.json`, "utf8"),
  );
  if (!isRecord(parsed)) throw new Error(`${id} ${release}: snapshot is not an object`);
  return parsed;
}

function child(prefix: string, key: string): string {
  return prefix === "" ? key : `${prefix}.${key}`;
}

function asNodes(value: unknown): JsonObject[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(isRecord);
}

/** Every property path the schema declares, in the notation above. */
function schemaPaths(schema: JsonObject): string[] {
  const defs = isRecord(schema["$defs"]) ? schema["$defs"] : {};
  const found = new Set<string>();
  const walk = (node: JsonObject, prefix: string, refs: ReadonlyArray<string>): void => {
    const ref = node["$ref"];
    if (typeof ref === "string") {
      const name = ref.replace("#/$defs/", "");
      const target = defs[name];
      if (refs.includes(name) || !isRecord(target)) return;
      walk(target, prefix, [...refs, name]);
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      for (const branch of asNodes(node[key])) walk(branch, prefix, refs);
    }
    const properties = node["properties"];
    if (isRecord(properties)) {
      for (const [key, sub] of Object.entries(properties)) {
        const path = child(prefix, key);
        found.add(path);
        for (const subNode of asNodes(sub)) walk(subNode, path, refs);
      }
    }
    const records: unknown[] = [];
    const additional = node["additionalProperties"];
    if (isRecord(additional)) records.push(additional);
    const patterned = node["patternProperties"];
    if (isRecord(patterned)) records.push(...Object.values(patterned));
    for (const sub of records) {
      const path = child(prefix, "*");
      found.add(path);
      for (const subNode of asNodes(sub)) walk(subNode, path, refs);
    }
    if (node["items"] !== undefined) {
      const path = `${prefix}[]`;
      found.add(path);
      for (const subNode of asNodes(node["items"])) walk(subNode, path, refs);
    }
  };
  walk(schema, "", []);
  return [...found].toSorted();
}

/** Every path a document sets. */
function documentPaths(value: unknown, prefix = "", into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    if (value.length > 0) {
      const path = `${prefix}[]`;
      into.add(path);
      for (const item of value) documentPaths(item, path, into);
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      for (const path of [child(prefix, key), child(prefix, "*")]) {
        into.add(path);
        documentPaths(item, path, into);
      }
    }
  }
  return into;
}

function readFormatFile(id: string): FormatCaseFile | undefined {
  const path = `${formatsRoot}${id}.json`;
  if (!existsSync(path)) return undefined;
  const file: CorpusFile = parseCorpusFile(readFileSync(path, "utf8"), path);
  return "format" in file ? file : undefined;
}

const CONSTRAINT_KEYWORDS = ["pattern", "minLength", "maxLength", "minItems", "enum", "const"];

interface Constraint {
  readonly path: string;
  readonly keyword: string;
}

/**
 * Every distinct constraint of a snapshot, in the notation above: pattern, minLength,
 * maxLength, minItems, enum and const at the node's own path, `required` at each listed
 * key's own path. Sorted, each (path, keyword) once.
 */
function constraintPaths(schema: JsonObject): Constraint[] {
  const defs = isRecord(schema["$defs"]) ? schema["$defs"] : {};
  const found = new Map<string, Constraint>();
  const add = (path: string, keyword: string): void => {
    found.set(`${path}\u0000${keyword}`, { path, keyword });
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
      if (node[keyword] !== undefined && prefix !== "") add(prefix, keyword);
    }
    if (Array.isArray(node["required"])) {
      for (const key of node["required"]) {
        if (typeof key === "string") add(child(prefix, key), "required");
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

/** Whether a refusal line names the path of the constraint case `name` (see the test). */
function refusedAtItsPath(name: string, refusal: string): boolean {
  const [, path = "", keyword = ""] = /^constraint (\S+) (\S+)$/.exec(name) ?? [];
  if (path === "$schema" && keyword === "required" && refusal.includes("older than phax 0.17.0")) {
    return true;
  }
  const field = /^phases\[\]\.testStrategy\[\]\.(\w+)$/.exec(path)?.[1];
  if (field !== undefined && new RegExp(`^phase-\\d+ test line \\d+ ${field}:`).test(refusal)) {
    return true;
  }
  let pattern = "";
  for (const segment of path.match(/[^.[\]]+|\[\]/g) ?? []) {
    if (segment === "[]") pattern += String.raw`(?:\.\d+|\[\d+\])`;
    else if (segment === "*") pattern += String.raw`\.[^:\s[]+`;
    else pattern += (pattern === "" ? "" : String.raw`\.`) + segment.replace(/[$]/g, "\\$&");
  }
  return new RegExp(String.raw`(?:^|\n)\s*${pattern}(?:\.\d+|\[\d+\])?:`).test(refusal);
}

function constraintCaseName(c: Constraint): string {
  return `constraint ${c.path} ${c.keyword}`;
}

/** Names of the cases that phax refuses. */
function refusedNames(cases: ReadonlyArray<{ name: string; expected: unknown }>): Set<string> {
  const names = new Set<string>();
  for (const c of cases) {
    if (isRecord(c.expected) && c.expected["ok"] === false) names.add(c.name);
  }
  return names;
}

/**
 * The formats phax writes: one of its `src/schemas` modules exports a `Schema.encode*`
 * writer of the format's file. Left out, because phax only reads them or writes them
 * without a Schema encoder:
 * - gate-report, brief-report: provider output phax reads as printed ("there is no encoder").
 * - hand-decision-answer, spec-hand-decision-answer, plan-hand-decision-answer: a decide
 *   session's answer, read only.
 * - decide-verdicts: the person's verdicts, read only.
 * - architecture-report: the provider's report, read only.
 * - architecture-request: written on the provider's stdin without a Schema encoder.
 * - cost-ledger: written with `withSchemaUrl`, no Schema encoder.
 * - oracle-request: frozen at 0.26.0, replaced by acceptance-request; phax no longer writes it.
 */
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

const encodeRoot = `${repoRoot}tests/behaviourCorpus/cases/encode/`;

const ids = formatIds();
const modules = frozenModules();

describe("behaviour corpus coverage", () => {
  it("reads every format id and every frozen module", () => {
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids.length).toBeGreaterThan(0);
    expect(modules.length).toBe(new Set(modules).size);
    expect(modules.length).toBeGreaterThan(0);
  });

  it("walks the notation on a small schema", () => {
    const schema: JsonObject = {
      $defs: {
        Name: { type: "string" },
        Tree: { properties: { child: { $ref: "#/$defs/Tree" } } },
      },
      properties: {
        name: { $ref: "#/$defs/Name" },
        list: { type: "array", items: { properties: { id: { type: "string" } } } },
        byKey: { type: "object", additionalProperties: { properties: { n: { type: "number" } } } },
        either: { anyOf: [{ properties: { a: { type: "string" } } }, { properties: { b: {} } }] },
        tree: { $ref: "#/$defs/Tree" },
      },
    };
    expect(schemaPaths(schema)).toEqual([
      "byKey",
      "byKey.*",
      "byKey.*.n",
      "either",
      "either.a",
      "either.b",
      "list",
      "list[]",
      "list[].id",
      "name",
      "tree",
      "tree.child",
    ]);
    // A key counts for its own path and for the `*` path of the record it sits in.
    const set = documentPaths({ list: [{ id: "x" }], byKey: { k: { n: 1 } }, either: { a: "y" } });
    for (const path of [
      "byKey",
      "byKey.*",
      "byKey.*.n",
      "either.a",
      "list",
      "list[]",
      "list[].id",
    ]) {
      expect(set.has(path), path).toBe(true);
    }
    expect(set.has("either.b")).toBe(false);
    expect(documentPaths({ list: [] }).has("list[]")).toBe(false);
  });

  for (const id of ids) {
    describe(id, () => {
      const file = readFormatFile(id);

      it("has a case file naming its format", () => {
        expect(file?.format).toBe(id);
      });

      it("sets every property path of its latest released JSON Schema", () => {
        if (file === undefined) throw new Error(`no case file for ${id}`);
        const release = latestRelease(id);
        const set = new Set<string>();
        for (const c of file.current) {
          if (c.expected?.ok === true && c.expected.shape === release) {
            for (const path of documentPaths(c.input)) set.add(path);
          }
        }
        const unset = schemaPaths(readSnapshot(id, release)).filter((path) => !set.has(path));
        expect(unset, `${id} ${release}: paths no accepted current case sets`).toEqual([]);
      });

      it("has a refused current case", () => {
        if (file === undefined) throw new Error(`no case file for ${id}`);
        expect(file.current.some((c) => c.expected?.ok === false)).toBe(true);
      });

      it("lists exactly the shapes of its frozen modules", () => {
        if (file === undefined) throw new Error(`no case file for ${id}`);
        const expected = modules
          .filter((module) => module.startsWith(`${id}/`))
          .map((module) => module.slice(id.length + 1))
          .toSorted();
        expect(Object.keys(file.shapes).toSorted()).toEqual(expected);
      });
    });
  }

  for (const module of modules) {
    it(`${module} has an accepted and a refused case`, () => {
      const slash = module.indexOf("/");
      const file = readFormatFile(module.slice(0, slash));
      const cases = file?.shapes[module.slice(slash + 1)] ?? [];
      expect(cases.some((c) => c.expected?.ok === true)).toBe(true);
      expect(cases.some((c) => c.expected?.ok === false)).toBe(true);
    });
  }

  for (const id of ids) {
    it(`${id} has a refused current case per constraint of its latest snapshot`, () => {
      const file = readFormatFile(id);
      if (file === undefined) throw new Error(`no case file for ${id}`);
      const release = latestRelease(id);
      const refused = refusedNames(file.current);
      const missing = constraintPaths(readSnapshot(id, release))
        .map(constraintCaseName)
        .filter((name) => !refused.has(name));
      expect(missing, `${id} ${release}: constraints without a refused current case`).toEqual([]);
    });
  }

  for (const module of modules) {
    it(`${module} has a refused case per constraint of its snapshot`, () => {
      const slash = module.indexOf("/");
      const id = module.slice(0, slash);
      const shape = module.slice(slash + 1);
      const snapshotPath = `${snapshotsRoot}${id}/${shape}.schema.json`;
      if (!existsSync(snapshotPath)) throw new Error(`${module}: no snapshot at ${snapshotPath}`);
      const parsed: unknown = JSON.parse(readFileSync(snapshotPath, "utf8"));
      if (!isRecord(parsed)) throw new Error(`${module}: snapshot is not an object`);
      const file = readFormatFile(id);
      const refused = refusedNames(file?.shapes[shape] ?? []);
      const missing = constraintPaths(parsed)
        .map(constraintCaseName)
        .filter((name) => !refused.has(name));
      expect(missing, `${module}: constraints without a refused case`).toEqual([]);
    });
  }

  // A constraint case guards its constraint only when that constraint is what refuses it: a
  // case refused at another path would replay the same line with the constraint loosened.
  // Two readings stand in for the path: a document with no `$schema` is refused by its
  // version check before any shape decodes it, and a plan's test line is named by its
  // phase and line (`phase-01 test line 1 loop: …`).
  for (const id of ids) {
    it(`${id} refuses each constraint case at the path it names`, () => {
      const file = readFormatFile(id);
      if (file === undefined) throw new Error(`no case file for ${id}`);
      const elsewhere = [file.current, ...Object.values(file.shapes)]
        .flat()
        .filter((c) => c.name.startsWith("constraint ") && c.expected?.ok === false)
        .filter((c) => c.expected?.ok === false && !refusedAtItsPath(c.name, c.expected.refusal))
        .map((c) => c.name);
      expect(elsewhere, `${id}: constraint cases refused at another path`).toEqual([]);
    });
  }

  for (const id of WRITTEN_FORMATS) {
    it(`${id} has encode cases that set every property path of its latest snapshot`, () => {
      expect(ids, `${id} is not a format id`).toContain(id);
      const path = `${encodeRoot}${id}.json`;
      if (!existsSync(path)) throw new Error(`no encode case file for ${id}`);
      const file = parseCorpusFile(readFileSync(path, "utf8"), path);
      if (!("subject" in file)) throw new Error(`${path}: not a subject case file`);
      expect(file.subject).toBe(`encode/${id}`);
      expect(file.cases.length).toBeGreaterThan(0);
      const set = new Set<string>();
      for (const c of file.cases) {
        expect(c.expected?.ok, `${c.name}: encoded value must be accepted`).toBe(true);
        if (c.expected?.ok === true) {
          for (const p of documentPaths(c.expected.value)) set.add(p);
        }
      }
      const release = latestRelease(id);
      const unset = schemaPaths(readSnapshot(id, release)).filter((p) => !set.has(p));
      expect(unset, `${id} ${release}: paths no encoded case sets`).toEqual([]);
    });
  }
});
