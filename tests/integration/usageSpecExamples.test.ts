import { describe, expect, it } from "vitest";
import { generateUsageSpec } from "../../scripts/generate-usage-spec.js";
import { cliDocs } from "../../src/cli/cliDocs.js";

// Commands that must have both long_help and at least one example in the spec.
// This gate prevents a future regression where a new command is added to
// cliDocs but the generator fails to emit the metadata.
const DOCUMENTED_COMMANDS = Object.keys(cliDocs);

// Extract the text of a top-level cmd block (indent-0 closing brace convention).
function findCmdBlock(spec: string, cmdName: string): string | null {
  const start = spec.indexOf(`cmd "${cmdName}" {`);
  if (start === -1) return null;
  const end = spec.indexOf("\n}", start);
  if (end === -1) return null;
  return spec.slice(start, end + 2);
}

describe("usageSpec examples gate", () => {
  const spec = generateUsageSpec();

  for (const cmdName of DOCUMENTED_COMMANDS) {
    it(`cmd "${cmdName}" has a long_help node in the generated spec`, () => {
      const block = findCmdBlock(spec, cmdName);
      expect(block, `cmd "${cmdName}" block not found in spec`).not.toBeNull();
      expect(block, `cmd "${cmdName}" is missing a long_help node`).toContain("long_help ");
    });

    it(`cmd "${cmdName}" has at least one example node in the generated spec`, () => {
      const block = findCmdBlock(spec, cmdName);
      expect(block, `cmd "${cmdName}" block not found in spec`).not.toBeNull();
      expect(block, `cmd "${cmdName}" is missing an example node`).toContain("example ");
    });
  }
});
