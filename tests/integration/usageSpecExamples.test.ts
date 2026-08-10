import { describe, expect, it } from "vitest";
import { generateUsageSpec } from "../../scripts/generate-usage-spec.js";
import { cliDocs } from "../../src/cli/cliDocs.js";

// Commands that must have both long_help and at least one example in the spec.
// This gate prevents a future regression where a new command is added to
// cliDocs but the generator fails to emit the metadata.
const DOCUMENTED_COMMANDS = Object.keys(cliDocs);

// Extract a `cmd "x" { ... }` block by brace depth, so a nested block (with
// its own nested `cmd` children) is bounded correctly rather than by the
// first "\n}" that happens to follow the opening brace.
function extractBlock(text: string, startIdx: number): string {
  const braceIdx = text.indexOf("{", startIdx);
  let depth = 0;
  for (let i = braceIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return text.slice(startIdx);
}

// cmdName is a full command path ("run", "artifact status", ...); walk each
// space-separated segment into the matching nested cmd block.
function findCmdBlock(spec: string, cmdName: string): string | null {
  let scope = spec;
  let block: string | null = null;
  for (const segment of cmdName.split(" ")) {
    const start = scope.indexOf(`cmd "${segment}" {`);
    if (start === -1) return null;
    block = extractBlock(scope, start);
    scope = block;
  }
  return block;
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
