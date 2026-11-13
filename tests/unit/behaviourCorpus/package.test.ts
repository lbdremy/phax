// The schemas package, frozen at its Effect 3 state: its runtime export names and the
// bytes of its released JSON Schema snapshots are the baseline captured on Effect 3, kept
// in tests/behaviourCorpus/baseline/. Moving to Effect 4 changes how the package is built,
// never what it exports or what its released shapes are, so this test stays
// byte-identical through the migration. A format born after the baseline is not part of
// it: its `next` snapshot and, once a release cuts it, its released one. It imports no
// Effect module itself; the package it reads does.
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

describe("the schemas package against its Effect 3 baseline", () => {
  it("exports the runtime names the baseline captured", () => {
    const baseline = readBaseline("package-exports.json");
    if (!isStringArray(baseline)) throw new Error("package-exports.json: not a list of names");
    expect(baseline.length).toBeGreaterThan(0);
    expect(Object.keys(schemasPackage).toSorted()).toEqual(baseline);
  });

  // A format born after the baseline gets its released snapshot when a release cuts its
  // `next`; a format the baseline captured gets none.
  it("holds exactly the released snapshots the baseline captured, byte for byte", () => {
    const baseline = readBaseline("snapshot-digests.json");
    if (!isStringRecord(baseline))
      throw new Error("snapshot-digests.json: not a path to digest map");
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
    const current = Object.fromEntries(
      filesUnder(snapshotsRoot)
        .filter((path) => !path.endsWith("/next.schema.json"))
        .filter((path) => !bornAfterBaseline(path, baseline))
        .map((path): [string, string] => [
          path,
          createHash("sha256")
            .update(readFileSync(join(repoRoot, path)))
            .digest("hex"),
        ]),
    );
    expect(current).toEqual(baseline);
  });

  it("holds a next snapshot only for a format born after the baseline", () => {
    const baseline = readBaseline("snapshot-digests.json");
    if (!isStringRecord(baseline))
      throw new Error("snapshot-digests.json: not a path to digest map");
    const next = filesUnder(snapshotsRoot).filter((path) => path.endsWith("/next.schema.json"));
    expect(next.filter((path) => !bornAfterBaseline(path, baseline))).toEqual([]);
  });
});
