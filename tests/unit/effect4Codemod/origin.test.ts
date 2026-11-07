// How phax's Effect 4 codemod decides a symbol is Effect's: by following its import
// binding, through relative re-exports, to the module `effect` or `effect/…`. Never by
// the installed package's types, so a tree with no `effect` installed reads the same.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { rewriteFiles } from "../../../scripts/effect4-codemod/codemod.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixtures = "tests/unit/effect4Codemod/__fixtures__/reexport";
const usesPath = `${fixtures}/uses.ts`;
const reexportPath = `${fixtures}/effectReexport.ts`;

function readRepoFile(path: string): string {
  return readFileSync(`${repoRoot}${path}`, "utf8");
}

const temporaryRoots: Array<string> = [];

/** A temporary tree holding `files`, with no node_modules: nothing resolves `effect`. */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "phax-effect4-origin-"));
  temporaryRoots.push(root);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("effect4 codemod origin", () => {
  it("rewrites a symbol reached through a local re-export of effect", () => {
    const result = rewriteFiles({ root: repoRoot, files: [usesPath] });
    expect(result.files.map((file) => file.path)).toEqual([usesPath]);
    const [file] = result.files;
    expect(file?.before).toBe(readRepoFile(usesPath));
    expect(file?.after).toBe(readRepoFile(`${fixtures}/expected-uses.ts`));
    expect(file?.rewrites["either-to-result"] ?? 0).toBeGreaterThan(0);
    expect(result.leftovers).toEqual([]);
  });

  it("renames the re-export with its importer when both are rewritten", () => {
    const result = rewriteFiles({ root: repoRoot, files: [reexportPath, usesPath] });
    const [reexport, uses] = result.files;
    expect(reexport?.after).toBe(
      readRepoFile(reexportPath).replace(
        'export { Either } from "effect";',
        'export { Result } from "effect";',
      ),
    );
    expect(uses?.after).toBe(readRepoFile(`${fixtures}/expected-uses.ts`));
  });

  it("leaves a namesake exported by a local module that does not re-export effect", () => {
    const uses = 'import { Either } from "./either.js";\n\nexport const ok = Either.right(1);\n';
    const root = tree({
      "either.ts": "export const Either = { right: (value: number) => ({ value }) };\n",
      "uses.ts": uses,
    });
    const result = rewriteFiles({ root, files: ["uses.ts"] });
    expect(result.files[0]?.after).toBe(uses);
    expect(result.leftovers).toEqual([]);
  });

  it("decides origin from the import alone, with no effect package installed", () => {
    const root = tree({
      "uses.ts": 'import { Either as E } from "effect";\n\nexport const ok = E.right(1);\n',
    });
    const result = rewriteFiles({ root, files: ["uses.ts"] });
    expect(result.files[0]?.after).toBe(
      'import { Result as E } from "effect";\n\nexport const ok = E.succeed(1);\n',
    );
  });

  it("leaves a use shadowed by a local declaration of the same name", () => {
    const uses = [
      'import { Effect } from "effect";',
      "",
      "export const settle = (effect: Effect.Effect<number>) => Effect.either(effect);",
      "export function local(Effect: { either: (value: number) => number }) {",
      "  return Effect.either(1);",
      "}",
      "",
    ].join("\n");
    const root = tree({ "uses.ts": uses });
    const result = rewriteFiles({ root, files: ["uses.ts"] });
    expect(result.files[0]?.after).toBe(
      uses.replace("=> Effect.either(effect)", "=> Effect.result(effect)"),
    );
  });
});
