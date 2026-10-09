// Simulates a release cut on a temporary copy of the tree: the release commit
// keeps the snapshot gate green, and the copy's package reads documents at
// the new release. The real tree is never cut; every test checks it is
// untouched. O is the opened version: package.json's when the real tree is
// already opened above the ledger, else the next minor of the ledger's last
// entry, opened on the copy first. So a real release or opening never needs
// this test edited.
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
import { afterAll, afterEach, describe, expect, it } from "vitest";
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
import { openRelease } from "../../scripts/release-open.js";
import { applySchemasWrite, checkSchemas, readSchemasState } from "../../scripts/schemas-check.js";
import {
  FORMAT_IDS,
  compareReleases,
  isRelease,
  schemaUrl,
  type FormatId,
} from "../../src/schemas/schemaUrl.js";
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
  "examples/hello-world/brief.mjs",
];
const COPIED_DIRS = ["src", "packages/schemas/snapshots", "packages/schemas/src"];
const MANIFESTS = ["package.json", "npm/package.json", "packages/schemas/package.json"];
const GENERATED_INDEX = "packages/schemas/src/generated/index.ts";
const RELEASE_MODULE = "src/schemas/release.ts";
const LOCK = "packages/schemas/history.lock.json";
const LEDGER = "packages/schemas/releases.json";
const EXAMPLES = ["examples/hello-world/audit.mjs", "examples/hello-world/brief.mjs"];
/** Every path the cut could touch, as files or directories. */
const CUT_SCOPE = [
  ...MANIFESTS,
  "packages/schemas/snapshots",
  GENERATED_INDEX,
  RELEASE_MODULE,
  LOCK,
  LEDGER,
  ...EXAMPLES,
];
/** The files a cut never changes. */
const UNCUT = [...MANIFESTS, RELEASE_MODULE, ...EXAMPLES];

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

const realLedger = ledgerOf(repoRoot);
const lastRelease = realLedger.at(-1)!;
const rootVersion = versionOf(repoRoot);
const realOpened = compareReleases(rootVersion, lastRelease) > 0;
const O = realOpened ? rootVersion : nextMinor(lastRelease);

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

/** A copy whose manifests name O, opened with `openRelease` when the real tree is not. */
function openedCopy(): string {
  const root = makeCopy();
  if (!realOpened) openRelease(root, O);
  return root;
}

async function importFrom<T>(root: string, path: string): Promise<T> {
  return (await import(pathToFileURL(join(root, path)).href)) as T;
}

/** The formats whose `next` snapshot the cut renames. */
function formatsWithNext(root: string): FormatId[] {
  return FORMAT_IDS.filter((id) => existsSync(join(root, snapshotPath(id, "next"))));
}

// What the cut of O must produce, derived from the real tree: every renamed
// `next` becomes O, every other format keeps its current shape.
const renamed = formatsWithNext(repoRoot);
const expectedShapes = Object.fromEntries(
  FORMAT_IDS.map((id) => [id, renamed.includes(id) ? O : CURRENT_SHAPES[id]]),
);
const expectedFirstSupported = FIRST_SUPPORTED_RELEASE ?? (renamed.length > 0 ? O : null);

afterEach(() => {
  expect(hashTree(repoRoot, CUT_SCOPE)).toEqual(realBefore);
});

afterAll(() => {
  for (const root of copies) rmSync(root, { recursive: true, force: true });
});

describe("cutRelease on an opened copy of the tree", () => {
  it(`cuts ${O}: renames next snapshots, regenerates the shapes, appends the ledger, with the gate green`, async () => {
    const copy = openedCopy();
    const before = hashTree(copy, ["."]);
    const nextBytes = new Map(
      renamed.map((id) => [id, readFileSync(join(copy, snapshotPath(id, "next")))]),
    );

    const { changed } = cutRelease(copy, O);

    for (const id of FORMAT_IDS) {
      expect(existsSync(join(copy, snapshotPath(id, "next")))).toBe(false);
    }
    for (const [id, bytes] of nextBytes) {
      expect(readFileSync(join(copy, snapshotPath(id, O)))).toEqual(bytes);
    }
    const after = hashTree(copy, ["."]);
    for (const path of UNCUT) expect(after.get(path), path).toBe(before.get(path));
    for (const [path, hash] of before) {
      if (path.endsWith("/pre-schema.schema.json")) expect(after.get(path)).toBe(hash);
    }
    expect(after.get(LOCK)).toBe(before.get(LOCK));
    expect(readFileSync(join(copy, LEDGER), "utf8")).toBe(
      `${JSON.stringify({ releases: [...realLedger, O] }, null, 2)}\n`,
    );

    const generated = await importFrom<GeneratedIndex>(copy, GENERATED_INDEX);
    expect(generated.PACKAGE_VERSION).toBe(O);
    expect(generated.FIRST_SUPPORTED_RELEASE).toBe(expectedFirstSupported);
    expect(generated.CURRENT_SHAPES).toEqual(expectedShapes);

    expect(checkSchemas(readSchemasState(copy))).toEqual([]);
    expect(changed).toEqual(differences(before, after));
  });

  // A format whose decoder changed since its last release: its release
  // snapshot no longer matches the render, and a `next` snapshot does.
  it(`renames a planted next snapshot to ${O}, leaving the manifests, stamps and examples alone`, async () => {
    const copy = openedCopy();
    const id = FORMAT_IDS.find((format) => !renamed.includes(format))!;
    const latest = CURRENT_SHAPES[id];
    expect(isRelease(latest)).toBe(true);
    const latestPath = join(copy, snapshotPath(id, latest));
    const bytes = readFileSync(latestPath);
    writeFileSync(join(copy, snapshotPath(id, "next")), bytes);
    const changedLatest = { ...(JSON.parse(bytes.toString("utf8")) as object), $comment: "old" };
    writeFileSync(latestPath, `${JSON.stringify(changedLatest, null, 2)}\n`);
    applySchemasWrite(copy);
    expect(existsSync(join(copy, snapshotPath(id, "next")))).toBe(true);
    const before = hashTree(copy, ["."]);

    const { changed } = cutRelease(copy, O);

    expect(existsSync(join(copy, snapshotPath(id, "next")))).toBe(false);
    expect(readFileSync(join(copy, snapshotPath(id, O)))).toEqual(bytes);
    const after = hashTree(copy, ["."]);
    for (const path of UNCUT) expect(after.get(path), path).toBe(before.get(path));
    expect(changed).toEqual(differences(before, after));
    expect(changed).toContain(snapshotPath(id, "next"));
    expect(changed).toContain(snapshotPath(id, O));
    const generated = await importFrom<GeneratedIndex>(copy, GENERATED_INDEX);
    expect(generated.CURRENT_SHAPES[id]).toBe(O);
  });

  it(`leaves the copy's package reading documents at ${O}`, async () => {
    const copy = openedCopy();
    cutRelease(copy, O);
    const pkg = await importFrom<PackageEntry>(copy, "packages/schemas/src/index.ts");
    const id = "phase-record-manifest";
    const shape = expectedShapes[id];
    const atO = withKey(validDocuments[id], "$schema", schemaUrl(id, O));

    expect(pkg.parsePhaseRecordManifest(atO)).toMatchObject({ ok: true, shape });
    expect(pkg.parseDocument(atO)).toMatchObject({ ok: true, format: id, shape });

    // Below the first supported release, no decoder tries a stamp.
    const developmentRelease = FIRST_SUPPORTED_RELEASE === null ? lastRelease : "0.0.0";
    const developmentUrl = schemaUrl(id, developmentRelease);
    const development = withKey(validDocuments[id], "$schema", developmentUrl);
    expect(pkg.parsePhaseRecordManifest(development)).toEqual({
      ok: false,
      error: {
        path: "$schema",
        message: developmentBuildMessage(developmentUrl, expectedFirstSupported ?? O),
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
        `phax ${expectedFirstSupported ?? O}, the first supported release`,
      );
    }
  });

  it(`cuts ${nextMinor(O)}, opened after ${O}, changing only the ledger`, () => {
    const copy = openedCopy();
    cutRelease(copy, O);
    openRelease(copy, nextMinor(O));
    const before = hashTree(copy, ["."]);

    const { changed } = cutRelease(copy, nextMinor(O));

    const after = hashTree(copy, ["."]);
    expect(differences(before, after)).toEqual([LEDGER]);
    expect(changed).toEqual([LEDGER]);
    expect(ledgerOf(copy).slice(-2)).toEqual([O, nextMinor(O)]);
    expect(checkSchemas(readSchemasState(copy))).toEqual([]);
  });

  describe("refuses before writing anything", () => {
    function expectRefused(copy: string, version: string, message: string): void {
      const before = hashTree(copy, ["."]);
      expect(() => cutRelease(copy, version)).toThrow(message);
      expect(hashTree(copy, ["."])).toEqual(before);
    }

    it.each([
      ["the next minor", nextMinor(O)],
      ["the last release", lastRelease],
    ])(`a version other than ${O}: %s`, (_label, version) => {
      expectRefused(
        openedCopy(),
        version,
        `${version} is not the opened version ${O} — re-open first: scripts/release.sh --open ${version}`,
      );
    });

    it(`a release ledger that already ends at ${O}`, () => {
      const copy = openedCopy();
      writeLedger(copy, [...realLedger, O]);
      expectRefused(copy, O, `${O} is not newer than the last release ${O} — nothing cut`);
    });

    it("a missing release ledger", () => {
      const copy = openedCopy();
      rmSync(join(copy, LEDGER));
      expectRefused(copy, O, `${LEDGER} is missing — nothing cut`);
    });

    it.each([
      ["not JSON", "{", "is not JSON — nothing cut"],
      ["without releases", "{}\n", 'must hold { "releases": ["X.Y.Z", …] } — nothing cut'],
    ])("a release ledger %s", (_label, text, message) => {
      const copy = openedCopy();
      writeFileSync(join(copy, LEDGER), text);
      expectRefused(copy, O, message);
    });

    it("an out-of-order release ledger", () => {
      const copy = openedCopy();
      writeLedger(copy, [lastRelease, "0.0.1", lastRelease]);
      expectRefused(copy, O, "not strictly increasing — nothing cut");
    });

    it("a malformed version", () => {
      expectRefused(openedCopy(), "1.2", "1.2 is not a release (X.Y.Z)");
    });

    it(`an existing ${O} snapshot`, () => {
      const copy = openedCopy();
      const existing = snapshotPath("registry", O);
      writeFileSync(join(copy, existing), "{}\n");
      expectRefused(copy, O, `${existing} already exists`);
    });
  });
});
