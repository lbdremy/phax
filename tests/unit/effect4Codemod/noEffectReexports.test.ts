// No source file re-exports an `effect` module. The codemod renames a barrel's re-export
// (`export { Either } from "effect"` becomes `Result`) but an importer of that barrel only
// when every one of its uses is rewritten: an importer left with a use no rule covers would
// keep a name the barrel no longer exports, and drop out of the leftover report. None exists
// in the repository, and this keeps it so for the migration's length.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const ROOTS = ["src", "tests", "scripts", "packages/schemas/src"];
const REEXPORT = /^\s*export\s+(\*|\{[^}]*\})(\s+as\s+\w+)?\s+from\s+["']effect(\/[^"']*)?["']/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "__fixtures__"
        ? []
        : sourceFiles(path);
    }
    return /\.(ts|mts|cts)$/.test(entry.name) ? [path] : [];
  });
}

describe("effect4 codemod scope", () => {
  it("finds no re-export of an effect module in the repository's sources", () => {
    const offending = ROOTS.flatMap((root) => sourceFiles(join(repoRoot, root)))
      .filter((path) => REEXPORT.test(readFileSync(path, "utf8")))
      .map((path) => relative(repoRoot, path));
    expect(offending).toEqual([]);
  });
});
