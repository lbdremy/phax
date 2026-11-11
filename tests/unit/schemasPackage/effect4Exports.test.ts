// @lbdremy/phax-schemas exports Effect 4 Schema values under its 0.36.0
// names: every export the corpus captured at 0.36.0 that the package names a
// schema (`…Schema`, its convention for a Schema value) is one to the
// installed effect's `Schema.isSchema`.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as schemasPackage from "../../../packages/schemas/src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baseline: unknown = JSON.parse(
  readFileSync(join(repoRoot, "tests/behaviourCorpus/baseline/package-exports.json"), "utf8"),
);
const names = Array.isArray(baseline)
  ? baseline.filter((name): name is string => typeof name === "string")
  : [];
const schemaNames = names.filter((name) => name.endsWith("Schema"));
const exported: ReadonlyMap<string, unknown> = new Map(Object.entries(schemasPackage));

describe("the package's Schema exports on Effect 4", () => {
  it("reads the 0.36.0 export names, schemas among them", () => {
    expect(names.length).toBeGreaterThan(0);
    expect(schemaNames.length).toBeGreaterThan(0);
  });

  it.each(schemaNames)("%s is an Effect 4 Schema", (name) => {
    expect(exported.has(name)).toBe(true);
    expect(Schema.isSchema(exported.get(name))).toBe(true);
  });

  it("names no other export a schema", () => {
    for (const name of names.filter((candidate) => !candidate.endsWith("Schema"))) {
      expect(Schema.isSchema(exported.get(name)), name).toBe(false);
    }
  });
});
