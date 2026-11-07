// What phax's Effect 4 codemod must leave alone and what it must report: local namesakes
// of Effect symbols (not imported from `effect`) come back byte-identical with no
// rewrite and no leftover, and a file whose Effect symbol no rule covers comes back
// byte-identical with that symbol listed by file and line, under the topic skill that
// owns it, with the line of its entry in the vendored v3-to-v4.md.
//
// Acceptance tests passed by phase-05: every test is marked `.fails` until the codemod
// exists. Each test is written out, never generated, so its marker reads statically.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rewriteFiles, type CodemodResult } from "../../../scripts/effect4-codemod/codemod.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const namesakesPath = "tests/unit/effect4Codemod/__fixtures__/namesakes/input.ts";
const uncoveredPath = "tests/unit/effect4Codemod/__fixtures__/uncovered/input.ts";

function readRepoFile(path: string): string {
  return readFileSync(`${repoRoot}${path}`, "utf8");
}

/** The one file entry of a single-file run, checked to be the requested path. */
function onlyFile(result: CodemodResult, path: string): CodemodResult["files"][number] {
  expect(result.files.map((file) => file.path)).toEqual([path]);
  const [file] = result.files;
  if (file === undefined) throw new Error(`no entry for ${path}`);
  return file;
}

function totalRewrites(file: CodemodResult["files"][number]): number {
  return Object.values(file.rewrites).reduce((sum, count) => sum + count, 0);
}

/** The 1-based line of the first line of `text` that contains `needle`. */
function lineOf(text: string, needle: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`${needle} not found`);
  return index + 1;
}

describe("effect4 codemod report", () => {
  it("leaves local namesakes of Effect symbols byte-identical, with no leftover", () => {
    const result = rewriteFiles({ root: repoRoot, files: [namesakesPath] });
    const file = onlyFile(result, namesakesPath);
    expect(file.before).toBe(readRepoFile(namesakesPath));
    expect(file.after).toBe(file.before);
    expect(totalRewrites(file)).toBe(0);
    expect(result.leftovers).toEqual([]);
  });

  it("leaves a file whose Effect symbol no rule covers byte-identical", () => {
    const file = onlyFile(rewriteFiles({ root: repoRoot, files: [uncoveredPath] }), uncoveredPath);
    expect(file.before).toBe(readRepoFile(uncoveredPath));
    expect(file.after).toBe(file.before);
    expect(totalRewrites(file)).toBe(0);
  });

  it("lists ParseResult.ArrayFormatter by file and line under effect4-schema", () => {
    const result = rewriteFiles({ root: repoRoot, files: [uncoveredPath] });
    expect(result.leftovers).toEqual([
      {
        path: uncoveredPath,
        line: lineOf(readRepoFile(uncoveredPath), "ParseResult.ArrayFormatter"),
        v3Symbol: "ParseResult.ArrayFormatter",
        referenceLine: 13066,
        owner: "effect4-schema",
      },
    ]);
  });
});
