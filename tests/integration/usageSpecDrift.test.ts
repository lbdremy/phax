import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateUsageSpec } from "../../scripts/generate-usage-spec.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const specPath = join(repoRoot, "phax.usage.kdl");

describe("phax.usage.kdl drift gate", () => {
  it("committed phax.usage.kdl is byte-identical to the generator output (run `pnpm gen:usage-spec` to fix)", () => {
    const committed = readFileSync(specPath, "utf8");
    const generated = generateUsageSpec();

    expect(
      generated,
      "phax.usage.kdl is out of sync with the CLI definition.\n" +
        "Fix: pnpm gen:usage-spec\n\n" +
        "This gate fails when a Commander command, flag, or argument changes\n" +
        "without regenerating the spec. Run `pnpm gen:usage-spec` and commit\n" +
        "the updated phax.usage.kdl.",
    ).toBe(committed);
  });
});
