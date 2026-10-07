// Simulates a release cut on a temporary copy of the tree: the release commit
// keeps the snapshot gate green, and the copy's package reads documents at
// the new release. The real tree is never cut; every test checks it is
// untouched. X is the next minor of the root version, so a real release never
// needs this test edited.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../../packages/schemas/build/generated.js";
import { snapshotPath } from "../../packages/schemas/build/snapshots.js";
import {
  CURRENT_SHAPES,
  FIRST_SUPPORTED_RELEASE,
} from "../../packages/schemas/src/generated/index.js";
import {
  developmentBuildMessage,
  preSchemaUnsupportedMessage,
} from "../../packages/schemas/src/shapes.js";
import { cutRelease } from "../../scripts/release-cut.js";
import { checkSchemas, readSchemasState } from "../../scripts/schemas-check.js";
import { FORMAT_IDS, schemaUrl, type FormatId } from "../../src/schemas/schemaUrl.js";
import {
  preSchemaDocuments,
  validDocuments,
  withKey,
  withoutKey,
} from "./schemasPackage/documents.js";

type PackageEntry = typeof import("../../packages/schemas/src/index.js");
type GeneratedIndex = typeof import("../../packages/schemas/src/generated/index.js");

const repoRoot = resolve(import.meta.dirname, "../..");

const COPIED_FILES = [
  "package.json",
  "npm/package.json",
  "packages/schemas/package.json",
  "packages/schemas/history.lock.json",
  "packages/schemas/releases.json",
  "examples/hello-world/audit.mjs",
];
const COPIED_DIRS = ["src", "packages/schemas/snapshots", "packages/schemas/src"];
const MANIFESTS = ["package.json", "npm/package.json", "packages/schemas/package.json"];
const GENERATED_INDEX = "packages/schemas/src/generated/index.ts";
const RELEASE_MODULE = "src/schemas/release.ts";
const LOCK = "packages/schemas/history.lock.json";
const LEDGER = "packages/schemas/releases.json";
const EXAMPLE_AUDIT = "examples/hello-world/audit.mjs";
/** Every path the cut could touch, as files or directories. */
const CUT_SCOPE = [
  ...MANIFESTS,
  "packages/schemas/snapshots",
  GENERATED_INDEX,
  RELEASE_MODULE,
  LOCK,
  LEDGER,
  EXAMPLE_AUDIT,
];

/** The gate-diagnostics `$schema` literal the example audit prints at `release`. */
function exampleStamp(release: string): string {
  return `"${schemaUrl("gate-diagnostics", release)}"`;
}

function ledgerOf(root: string): ReadonlyArray<string> {
  return (JSON.parse(readFileSync(join(root, LEDGER), "utf8")) as { releases: string[] }).releases;
}

function writeLedger(root: string, releases: ReadonlyArray<string>): void {
  writeFileSync(join(root, LEDGER), `${JSON.stringify({ releases }, null, 2)}\n`);
}

function versionOf(root: string, manifest = "package.json"): string {
  return (JSON.parse(readFileSync(join(root, manifest), "utf8")) as { version: string }).version;
}

function nextMinor(release: string): string {
  const [major = 0, minor = 0] = release.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

const rootVersion = versionOf(repoRoot);
const X = nextMinor(rootVersion);
const Y = nextMinor(X);

/** Repo-relative path → sha256 of every file under `paths` (files or directories) in `root`. */
function hashTree(root: string, paths: ReadonlyArray<string>): Map<string, string> {
  const hashes = new Map<string, string>();
  const visit = (absolute: string): void => {
    if (!existsSync(absolute)) return;
    if (!lstatSync(absolute).isDirectory()) {
      hashes.set(relative(root, absolute).split("\\").join("/"), sha256(readFileSync(absolute)));
      return;
    }
    for (const name of readdirSync(absolute)) {
      if (name !== "node_modules") visit(join(absolute, name));
    }
  };
  for (const path of paths) visit(join(root, path));
  return hashes;
}

/** The paths created, modified or removed between two `hashTree` results, sorted. */
function differences(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).toSorted();
}

const realBefore = hashTree(repoRoot, CUT_SCOPE);
const copies: string[] = [];
let copy = "";

function makeCopy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-release-cut-")));
  for (const path of COPIED_FILES) cpSync(join(repoRoot, path), join(root, path));
  for (const dir of COPIED_DIRS) {
    cpSync(join(repoRoot, dir), join(root, dir), { recursive: true });
  }
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir");
  copies.push(root);
  return root;
}

async function importFrom<T>(root: string, path: string): Promise<T> {
  return (await import(pathToFileURL(join(root, path)).href)) as T;
}

/** The formats whose `next` snapshot the cut renames. */
function formatsWithNext(root: string): FormatId[] {
  return FORMAT_IDS.filter((id) => existsSync(join(root, snapshotPath(id, "next"))));
}

// What the copy's first cut to X must produce, derived from the real tree:
// every renamed `next` becomes X, every other format keeps its current shape.
const renamed = formatsWithNext(repoRoot);
const expectedShapes = Object.fromEntries(
  FORMAT_IDS.map((id) => [id, renamed.includes(id) ? X : CURRENT_SHAPES[id]]),
);
const expectedFirstSupported = FIRST_SUPPORTED_RELEASE ?? (renamed.length > 0 ? X : null);

beforeEach(() => {
  copy = makeCopy();
});

afterEach(() => {
  expect(hashTree(repoRoot, CUT_SCOPE)).toEqual(realBefore);
});

afterAll(() => {
  for (const root of copies) rmSync(root, { recursive: true, force: true });
});

describe("cutRelease on a copy of the tree", () => {
  it(`cuts ${X}: manifests, snapshots and generated files, with the gate green`, async () => {
    const before = hashTree(copy, ["."]);
    const nextBytes = new Map(
      renamed.map((id) => [id, readFileSync(join(copy, snapshotPath(id, "next")))]),
    );

    const { changed } = cutRelease(copy, X);

    for (const manifest of MANIFESTS) expect(versionOf(copy, manifest)).toBe(X);
    for (const id of FORMAT_IDS) {
      expect(existsSync(join(copy, snapshotPath(id, "next")))).toBe(false);
    }
    for (const [id, bytes] of nextBytes) {
      expect(readFileSync(join(copy, snapshotPath(id, X)))).toEqual(bytes);
    }
    const after = hashTree(copy, ["."]);
    for (const [path, hash] of before) {
      if (path.endsWith("/pre-schema.schema.json")) expect(after.get(path)).toBe(hash);
    }
    expect(after.get(LOCK)).toBe(before.get(LOCK));

    const generated = await importFrom<GeneratedIndex>(copy, GENERATED_INDEX);
    expect(generated.PACKAGE_VERSION).toBe(X);
    expect(generated.FIRST_SUPPORTED_RELEASE).toBe(expectedFirstSupported);
    expect(generated.CURRENT_SHAPES).toEqual(expectedShapes);
    expect(readFileSync(join(copy, RELEASE_MODULE), "utf8")).toContain(
      `export const PHAX_RELEASE = ${JSON.stringify(X)};`,
    );

    expect(checkSchemas(readSchemasState(copy))).toEqual([]);
    expect(changed).toEqual(differences(before, after));
  });

  it(`leaves the copy's package reading documents at ${X}`, async () => {
    cutRelease(copy, X);
    const pkg = await importFrom<PackageEntry>(copy, "packages/schemas/src/index.ts");
    const id = "phase-record-manifest";
    const shape = expectedShapes[id];
    const atX = withKey(validDocuments[id], "$schema", schemaUrl(id, X));

    expect(pkg.parsePhaseRecordManifest(atX)).toMatchObject({ ok: true, shape });
    expect(pkg.parseDocument(atX)).toMatchObject({ ok: true, format: id, shape });

    // A development build stamps the release it is heading for before that
    // release is cut: below the first supported release, no decoder tries it.
    const developmentRelease = FIRST_SUPPORTED_RELEASE === null ? rootVersion : "0.0.0";
    const developmentUrl = schemaUrl(id, developmentRelease);
    const development = withKey(validDocuments[id], "$schema", developmentUrl);
    expect(pkg.parsePhaseRecordManifest(development)).toEqual({
      ok: false,
      error: {
        path: "$schema",
        message: developmentBuildMessage(developmentUrl, expectedFirstSupported ?? X),
      },
    });

    expect(pkg.parsePhaseRecordManifest(preSchemaDocuments[id])).toMatchObject({
      ok: true,
      shape: "pre-schema",
    });

    const rejected = pkg.parsePhaseRecordManifest(withoutKey(preSchemaDocuments[id], "runId"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      const older = preSchemaUnsupportedMessage(
        "phase record manifest",
        "",
        expectedFirstSupported,
      ).slice(0, -" ()".length);
      expect(rejected.error.message.startsWith(older)).toBe(true);
      expect(rejected.error.message).toContain(
        `phax ${expectedFirstSupported ?? X}, the first supported release`,
      );
    }
  });

  it(`cuts ${Y} after ${X} without renaming anything`, async () => {
    cutRelease(copy, X);
    const before = hashTree(copy, ["."]);

    const { changed } = cutRelease(copy, Y);

    const after = hashTree(copy, ["."]);
    expect(differences(before, after)).toEqual(
      [...MANIFESTS, GENERATED_INDEX, RELEASE_MODULE, LEDGER, EXAMPLE_AUDIT].toSorted(),
    );
    expect(readFileSync(join(copy, EXAMPLE_AUDIT), "utf8")).toContain(exampleStamp(Y));
    expect(ledgerOf(copy).slice(-2)).toEqual([X, Y]);
    expect(changed).toEqual(differences(before, after));
    for (const manifest of MANIFESTS) expect(versionOf(copy, manifest)).toBe(Y);
    const generated = await importFrom<GeneratedIndex>(copy, GENERATED_INDEX);
    expect(generated.PACKAGE_VERSION).toBe(Y);
    expect(generated.FIRST_SUPPORTED_RELEASE).toBe(expectedFirstSupported);
    expect(generated.CURRENT_SHAPES).toEqual(expectedShapes);
    expect(readFileSync(join(copy, RELEASE_MODULE), "utf8")).toContain(
      `export const PHAX_RELEASE = ${JSON.stringify(Y)};`,
    );
    expect(checkSchemas(readSchemasState(copy))).toEqual([]);
  });

  it(`appends ${X} to the release ledger and reports it`, () => {
    const before = ledgerOf(copy);

    const { changed } = cutRelease(copy, X);

    expect(ledgerOf(copy)).toEqual([...before, X]);
    expect(readFileSync(join(copy, LEDGER), "utf8")).toBe(
      `${JSON.stringify({ releases: [...before, X] }, null, 2)}\n`,
    );
    expect(changed).toContain(LEDGER);
  });

  it(`rewrites the example audit's stamp to ${X}, keeping every other byte, and reports it`, () => {
    const before = readFileSync(join(copy, EXAMPLE_AUDIT), "utf8");
    expect(before).toContain(exampleStamp(rootVersion));

    const { changed } = cutRelease(copy, X);

    expect(readFileSync(join(copy, EXAMPLE_AUDIT), "utf8")).toBe(
      before.replace(exampleStamp(rootVersion), exampleStamp(X)),
    );
    expect(changed).toContain(EXAMPLE_AUDIT);
  });

  describe("refuses before writing anything", () => {
    it("a missing example audit", () => {
      rmSync(join(copy, EXAMPLE_AUDIT));
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, X)).toThrow(`${EXAMPLE_AUDIT} is missing — nothing cut`);
      expect(hashTree(copy, ["."])).toEqual(before);
    });

    it.each([
      ["without a stamp", (content: string) => content.replace(exampleStamp(rootVersion), '""'), 0],
      [
        "with a duplicated stamp",
        (content: string) => `${content}// ${exampleStamp(rootVersion)}\n`,
        2,
      ],
    ])("an example audit %s", (_label, edit, found) => {
      const path = join(copy, EXAMPLE_AUDIT);
      writeFileSync(path, edit(readFileSync(path, "utf8")));
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, X)).toThrow(
        `${EXAMPLE_AUDIT} must hold exactly one gate-diagnostics $schema literal, found ${found} — nothing cut`,
      );
      expect(hashTree(copy, ["."])).toEqual(before);
    });

    it("a missing release ledger", () => {
      rmSync(join(copy, LEDGER));
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, X)).toThrow(`${LEDGER} is missing — nothing cut`);
      expect(hashTree(copy, ["."])).toEqual(before);
    });

    it("an out-of-order release ledger", () => {
      writeLedger(copy, [rootVersion, "0.0.1", rootVersion]);
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, X)).toThrow("not strictly increasing — nothing cut");
      expect(hashTree(copy, ["."])).toEqual(before);
    });

    it("a release ledger whose last entry is not the package.json version", () => {
      writeLedger(copy, ["0.0.1"]);
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, X)).toThrow(
        `${LEDGER}: last entry 0.0.1, package.json version ${rootVersion} — nothing cut`,
      );
      expect(hashTree(copy, ["."])).toEqual(before);
    });

    it.each([
      ["a malformed version", "1.2", "is not a release"],
      ["the current version", rootVersion, "is not newer than"],
      ["an older version", "0.0.1", "is not newer than"],
    ])("%s", (_label, version, message) => {
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, version)).toThrow(message);
      expect(hashTree(copy, ["."])).toEqual(before);
    });

    it(`an existing ${X} snapshot`, () => {
      const existing = snapshotPath("registry", X);
      writeFileSync(join(copy, existing), "{}\n");
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, X)).toThrow(`${existing} already exists`);
      expect(hashTree(copy, ["."])).toEqual(before);
    });
  });
});
