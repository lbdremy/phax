// Generates phax.usage.kdl from phax's command definitions (src/cli/definitions/): the command
// runner's usage spec of phaxProgram, under a two-line header.
// Run with: pnpm gen:usage-spec
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { usageSpec } from "../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../src/cli/definitions/program.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../..");

export function generateUsageSpec(): string {
  return [
    "// Generated from phax's command definitions — do not edit by hand.",
    "// Regenerate with: pnpm gen:usage-spec",
    "",
    usageSpec(phaxProgram),
  ].join("\n");
}

// Only write when run as a script (`pnpm gen:usage-spec`). Importing this module
// — as the drift test does to call generateUsageSpec() — must not touch the
// committed file, or parallel test workers race on it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = generateUsageSpec();
  const outPath = join(repoRoot, "phax.usage.kdl");
  writeFileSync(outPath, output, "utf8");
  console.log(`Written: ${outPath}`);
}
