// Simulates an opening on a temporary copy of the tree. The real tree is never
// opened; every test checks it is untouched. Versions derive from the
// ledger's last entry L, so a real release or opening never needs this test
// edited.
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
import { CURRENT_SHAPES } from "../../packages/schemas/src/generated/index.js";
import { openRelease } from "../../scripts/release-open.js";
import { applySchemasWrite, checkSchemas, readSchemasState } from "../../scripts/schemas-check.js";
import { FORMAT_IDS, isRelease } from "../../src/schemas/schemaUrl.js";

type GeneratedIndex = typeof import("../../packages/schemas/src/generated/index.js");
type ReleaseModule = typeof import("../../src/schemas/release.js");

const repoRoot = resolve(import.meta.dirname, "../..");

const COPIED_FILES = [
  "package.json",
  "npm/package.json",
  "packages/schemas/package.json",
  "packages/schemas/history.lock.json",
  "packages/schemas/releases.json",
];
const COPIED_DIRS = ["src", "packages/schemas/snapshots", "packages/schemas/src"];
const MANIFESTS = ["package.json", "npm/package.json", "packages/schemas/package.json"];
const GENERATED_INDEX = "packages/schemas/src/generated/index.ts";
const RELEASE_MODULE = "src/schemas/release.ts";
const LOCK = "packages/schemas/history.lock.json";
const LEDGER = "packages/schemas/releases.json";
const SNAPSHOTS = "packages/schemas/snapshots";
/** Every path the opening could touch, as files or directories. */
const OPEN_SCOPE = [...MANIFESTS, SNAPSHOTS, GENERATED_INDEX, RELEASE_MODULE, LOCK, LEDGER];

function versionOf(root: string, manifest = "package.json"): string {
  return (JSON.parse(readFileSync(join(root, manifest), "utf8")) as { version: string }).version;
}

function nextMinor(release: string): string {
  const [major = 0, minor = 0] = release.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

const L = (
  JSON.parse(readFileSync(join(repoRoot, LEDGER), "utf8")) as { releases: string[] }
).releases.at(-1)!;
const V = nextMinor(nextMinor(L));

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

const realBefore = hashTree(repoRoot, OPEN_SCOPE);
const copies: string[] = [];

function makeCopy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-release-open-")));
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

/** The formats with a `next` snapshot under `root`. */
function formatsWithNext(root: string): ReadonlyArray<string> {
  return FORMAT_IDS.filter((id) => existsSync(join(root, snapshotPath(id, "next"))));
}

/**
 * Plants a `next` snapshot for a format that has none, as if its decoder had
 * changed since its last release: the release snapshot no longer matches the
 * render, and `next` does. Returns the format id.
 */
function plantNext(root: string): string {
  const id = FORMAT_IDS.find((format) => !formatsWithNext(root).includes(format))!;
  const latest = CURRENT_SHAPES[id];
  expect(isRelease(latest)).toBe(true);
  const latestPath = join(root, snapshotPath(id, latest));
  const bytes = readFileSync(latestPath);
  writeFileSync(join(root, snapshotPath(id, "next")), bytes);
  const changed = { ...(JSON.parse(bytes.toString("utf8")) as object), $comment: "old" };
  writeFileSync(latestPath, `${JSON.stringify(changed, null, 2)}\n`);
  applySchemasWrite(root);
  return id;
}

afterEach(() => {
  expect(hashTree(repoRoot, OPEN_SCOPE)).toEqual(realBefore);
});

afterAll(() => {
  for (const root of copies) rmSync(root, { recursive: true, force: true });
});

describe("openRelease on a copy of the tree", () => {
  it(`opens ${V}: manifests and generated versions and stamps, never the ledger or snapshots`, async () => {
    const copy = makeCopy();
    const planted = plantNext(copy);
    const withNext = formatsWithNext(copy);
    expect(withNext).toContain(planted);
    const before = hashTree(copy, ["."]);

    const { changed } = openRelease(copy, V);

    for (const manifest of MANIFESTS) expect(versionOf(copy, manifest)).toBe(V);
    const generated = await importFrom<GeneratedIndex>(copy, GENERATED_INDEX);
    expect(generated.PACKAGE_VERSION).toBe(V);
    const release = await importFrom<ReleaseModule>(copy, RELEASE_MODULE);
    expect(release.PHAX_RELEASE).toBe(V);
    expect(release.CURRENT_STAMPS).toEqual(
      Object.fromEntries(
        FORMAT_IDS.map((id) => [id, withNext.includes(id) ? V : CURRENT_SHAPES[id]]),
      ),
    );

    const after = hashTree(copy, ["."]);
    expect(after.get(LEDGER)).toBe(before.get(LEDGER));
    expect(after.get(LOCK)).toBe(before.get(LOCK));
    for (const [path, hash] of before) {
      if (path.startsWith(`${SNAPSHOTS}/`)) expect(after.get(path), path).toBe(hash);
    }
    expect(changed).toEqual(differences(before, after));
    expect(changed).toEqual([...MANIFESTS, GENERATED_INDEX, RELEASE_MODULE].toSorted());
  });

  it(`opens ${V} with the schemas check green`, () => {
    const copy = makeCopy();
    openRelease(copy, V);
    expect(checkSchemas(readSchemasState(copy))).toEqual([]);
  });

  describe("refuses before writing anything", () => {
    function expectRefused(copy: string, version: string, message: string): void {
      const before = hashTree(copy, ["."]);
      expect(() => openRelease(copy, version)).toThrow(message);
      expect(hashTree(copy, ["."])).toEqual(before);
    }

    it(`the last release ${L}, as not newer`, () => {
      expectRefused(makeCopy(), L, `${L} is not newer than the last release ${L} — nothing opened`);
    });

    it("an older release, as not newer", () => {
      expectRefused(makeCopy(), "0.0.1", `0.0.1 is not newer than the last release ${L}`);
    });

    it(`${V} twice, as already opened`, () => {
      const copy = makeCopy();
      openRelease(copy, V);
      expectRefused(copy, V, `${V} is already the opened version — nothing opened`);
    });

    it("a malformed version", () => {
      expectRefused(makeCopy(), "1.2", "1.2 is not a release (X.Y.Z)");
    });

    it("a missing release ledger", () => {
      const copy = makeCopy();
      rmSync(join(copy, LEDGER));
      expectRefused(copy, V, `${LEDGER} is missing — nothing opened`);
    });
  });
});
