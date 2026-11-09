// phax.json's `effect-migration` gate profile: it decodes through phax's config decoder,
// runs the ratchet every phase, and ends with check:full plus every terminal step of
// `standard`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaxConfig } from "../../../src/schemas/phaxConfig.js";

const phaxJson = fileURLToPath(new URL("../../../phax.json", import.meta.url));

function decoded() {
  const result = decodePhaxConfig(JSON.parse(readFileSync(phaxJson, "utf8")));
  if (Either.isLeft(result)) throw new Error(String(result.left));
  return result.right;
}

describe("phax.json", () => {
  it("decodes through phax's config decoder", () => {
    expect(() => decoded()).not.toThrow();
  });

  // `phax run` takes the first profile, so the operator lists effect-migration first for the
  // run that installs Effect 4 and puts standard back first at its merge (2026-11-09).
  it("keeps the standard profile beside effect-migration, listed first for the migration run", () => {
    expect(Object.keys(decoded().gateProfiles)).toEqual(["effect-migration", "standard"]);
  });

  it("runs format, the ratchet and lint every phase", () => {
    const steps = decoded().gateProfiles["effect-migration"] ?? [];
    const everyPhase = steps.filter((step) => step.firing === "every-phase");
    expect(everyPhase.map((step) => [step.command, step.surface])).toEqual([
      ["pnpm format", "local"],
      ["pnpm codemod:effect4 --ratchet", "local"],
      ["pnpm lint", "local"],
    ]);
  });

  it("ends with check:full and every terminal step of standard", () => {
    const profiles = decoded().gateProfiles;
    const terminal = (name: string) =>
      (profiles[name] ?? [])
        .filter((step) => step.firing === "terminal")
        .map((step) => [step.command, step.surface]);
    const migration = terminal("effect-migration");
    expect(migration).toContainEqual(["pnpm check:full", "local"]);
    expect(terminal("standard").length).toBeGreaterThan(0);
    for (const step of terminal("standard")) expect(migration).toContainEqual(step);
  });

  it("protects the corpus, the baseline and the ratchet, but not the counts file", () => {
    const protectedPaths = decoded().protectedPaths ?? [];
    expect(protectedPaths).toEqual([
      "tests/effect4Corpus/cases/**",
      "tests/effect4Corpus/baseline/**",
      "tests/effect4Corpus/corpus.ts",
      "tests/unit/effect4Corpus/**",
      "scripts/effect4-codemod/ratchet.ts",
      "scripts/effect4-codemod/counts.ts",
      "scripts/effect4-codemod/main.ts",
      "scripts/effect4-codemod/passingTests.ts",
      "tsconfig.json",
      "tsconfig.test.json",
      "vitest.config.ts",
      "**/__snapshots__/**",
      "packages/schemas/snapshots/**",
      "tests/fixtures/help/**",
      "tests/fixtures/usage/**",
      "tests/unit/commandLibrary/contract/fixtures/**",
      "tests/e2e/realFlow.test.ts",
      "tests/e2e/headlessAuthoring.test.ts",
      "tests/e2e/claudeProtectedPaths.test.ts",
      "tests/e2e/claudeSkillEditGrant.test.ts",
      "tests/unit/generateModelCatalog.test.ts",
      "tests/unit/reconciliation/global.test.ts",
    ]);
    // Every migration phase rewrites the ratchet's two records, so neither is protected.
    expect(protectedPaths.join("\n")).not.toContain("type-error-counts");
    expect(protectedPaths.join("\n")).not.toContain("passing-tests.json");
  });
});
