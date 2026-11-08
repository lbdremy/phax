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

  it("keeps the standard profile and adds effect-migration", () => {
    expect(Object.keys(decoded().gateProfiles)).toEqual(["standard", "effect-migration"]);
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
      "tsconfig.json",
      "tsconfig.test.json",
      "vitest.config.ts",
    ]);
    expect(protectedPaths.join("\n")).not.toContain("type-error-counts");
  });
});
