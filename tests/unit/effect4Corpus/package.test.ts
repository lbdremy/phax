// The schemas package, frozen at its Effect 3 state for the migration: its runtime
// export names and the bytes of its released JSON Schema snapshots are those captured
// by scripts/effect4-corpus-capture.ts into tests/effect4Corpus/baseline/. Moving to
// Effect 4 changes how the package is built, never what it exports or what its released
// shapes are, so this test stays byte-identical through the migration. It imports no
// Effect module itself; the package it reads does.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as schemasPackage from "../../../packages/schemas/src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const baselineRoot = join(repoRoot, "tests", "effect4Corpus", "baseline");
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

describe("the schemas package against its Effect 3 baseline", () => {
  it("exports the runtime names the baseline captured", () => {
    const baseline = readBaseline("package-exports.json");
    if (!isStringArray(baseline)) throw new Error("package-exports.json: not a list of names");
    expect(baseline.length).toBeGreaterThan(0);
    expect(Object.keys(schemasPackage).toSorted()).toEqual(baseline);
  });

  it("holds exactly the released snapshots the baseline captured, byte for byte", () => {
    const baseline = readBaseline("snapshot-digests.json");
    if (!isStringRecord(baseline))
      throw new Error("snapshot-digests.json: not a path to digest map");
    expect(Object.keys(baseline).length).toBeGreaterThan(0);
    const current = Object.fromEntries(
      filesUnder(snapshotsRoot).map((path): [string, string] => [
        path,
        createHash("sha256")
          .update(readFileSync(join(repoRoot, path)))
          .digest("hex"),
      ]),
    );
    expect(current).toEqual(baseline);
  });

  it("holds no next snapshot", () => {
    const next = filesUnder(snapshotsRoot).filter((path) => path.endsWith("/next.schema.json"));
    expect(next).toEqual([]);
  });
});
