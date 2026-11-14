// The schemas package, frozen at its Effect 3 state: its runtime export names and the
// bytes of its released JSON Schema snapshots are the baseline captured on Effect 3, kept
// in tests/behaviourCorpus/baseline/. Moving to Effect 4 changes how the package is built,
// never what it exports or what its released shapes are, so this test stays
// byte-identical through the migration. A format born after the baseline is not part of
// it: its `next` snapshot and, once a release cuts it, its released one. Nor is a later
// shape of a format the baseline captured: its `next` snapshot beside the captured ones,
// its released snapshot once a release after the baseline's cuts it, and the schema of
// the shape it froze, which the package exports as it does every released shape. It
// imports no Effect module itself; the package it reads does.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as schemasPackage from "../../../packages/schemas/src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const baselineRoot = join(repoRoot, "tests", "behaviourCorpus", "baseline");
const snapshotsRoot = join(repoRoot, "packages", "schemas", "snapshots");

function readBaseline(name: string): unknown {
  return JSON.parse(readFileSync(join(baselineRoot, name), "utf8"));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

/** Every file under `dir`, recursively, as repo-relative POSIX paths, sorted. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(repoRoot, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return found.toSorted();
}

/** A snapshot's format directory, `packages/schemas/snapshots/<format-id>/`. */
function formatDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** Whether the format a snapshot belongs to was born after the baseline: it captured none of its snapshots. */
function bornAfterBaseline(path: string, baseline: Readonly<Record<string, string>>): boolean {
  const directory = formatDirectory(path);
  return !Object.keys(baseline).some((captured) => formatDirectory(captured) === directory);
}

/** The release a snapshot path names (`…/<X.Y.Z>.schema.json`), if it names one. */
function snapshotRelease(path: string): readonly number[] | undefined {
  const match = /\/(\d+)\.(\d+)\.(\d+)\.schema\.json$/.exec(path);
  return match === null ? undefined : match.slice(1, 4).map(Number);
}

function compareReleases(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Whether a released snapshot was cut after every release the baseline captured. */
function releasedAfterBaseline(path: string, baseline: Readonly<Record<string, string>>): boolean {
  const release = snapshotRelease(path);
  if (release === undefined) return false;
  return Object.keys(baseline).every((captured) => {
    const capturedRelease = snapshotRelease(captured);
    return capturedRelease === undefined || compareReleases(release, capturedRelease) > 0;
  });
}

// The schema of a released shape the package lists: `<Format>V<X>_<Y>_<Z>Schema`.
const RELEASED_SHAPE_SCHEMA = /^[A-Z][A-Za-z]*V\d+_\d+_\d+Schema$/;

describe("the schemas package against its Effect 3 baseline", () => {
  it("exports the runtime names the baseline captured, and beside them only the schemas of shapes frozen since", () => {
    const baseline = readBaseline("package-exports.json");
    if (!isStringArray(baseline)) throw new Error("package-exports.json: not a list of names");
    expect(baseline.length).toBeGreaterThan(0);
    const exported = Object.keys(schemasPackage).toSorted();
    expect(baseline.filter((name) => !exported.includes(name))).toEqual([]);
    expect(
      exported.filter((name) => !baseline.includes(name) && !RELEASED_SHAPE_SCHEMA.test(name)),
    ).toEqual([]);
  });

  // A format born after the baseline gets its released snapshot when a release cuts its
  // `next`; a format the baseline captured gets one only from a release after the
  // baseline's, which cuts the `next` of a later shape.
  it("holds exactly the released snapshots the baseline captured, byte for byte", () => {
    const baseline = readBaseline("snapshot-digests.json");
    if (!isStringRecord(baseline))
      throw new Error("snapshot-digests.json: not a path to digest map");
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
    const current = Object.fromEntries(
      filesUnder(snapshotsRoot)
        .filter((path) => !path.endsWith("/next.schema.json"))
        .filter((path) => !bornAfterBaseline(path, baseline))
        .filter((path) => !releasedAfterBaseline(path, baseline))
        .map((path): [string, string] => [
          path,
          createHash("sha256")
            .update(readFileSync(join(repoRoot, path)))
            .digest("hex"),
        ]),
    );
    expect(current).toEqual(baseline);
  });

  // A later shape of a captured format is recorded as `next` beside the captured
  // snapshots, never in place of one: its latest captured release is still there.
  it("holds a next snapshot of a format the baseline captured only beside that format's captured snapshots", () => {
    const baseline = readBaseline("snapshot-digests.json");
    if (!isStringRecord(baseline))
      throw new Error("snapshot-digests.json: not a path to digest map");
    const files = filesUnder(snapshotsRoot);
    const next = files.filter((path) => path.endsWith("/next.schema.json"));
    expect(
      next
        .filter((path) => !bornAfterBaseline(path, baseline))
        .filter((path) => {
          const captured = Object.keys(baseline).filter(
            (snapshot) => formatDirectory(snapshot) === formatDirectory(path),
          );
          return !captured.every((snapshot) => files.includes(snapshot));
        }),
    ).toEqual([]);
  });
});
