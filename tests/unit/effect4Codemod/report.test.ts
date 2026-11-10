// What phax's Effect 4 codemod must leave alone and what it must report: local namesakes
// of Effect symbols (not imported from `effect`) come back byte-identical with no
// rewrite and no leftover, and a file whose Effect symbol no rule covers comes back
// byte-identical with that symbol listed by file and line, under the topic skill that
// owns it, with the line of its entry in the vendored v3-to-v4.md.
//
// Acceptance tests passed by phase-05: every test is marked `.fails` until the codemod
// exists. Each test is written out, never generated, so its marker reads statically.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rewriteFiles, type CodemodResult } from "../../../scripts/effect4-codemod/codemod.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const namesakesPath = "tests/unit/effect4Codemod/__fixtures__/namesakes/input.ts";
const uncoveredPath = "tests/unit/effect4Codemod/__fixtures__/uncovered/input.ts";
const v4ShapedPath = "tests/unit/effect4Codemod/__fixtures__/v4-shaped/input.ts";
const blockedPath = "tests/unit/effect4Codemod/__fixtures__/blocked/input.ts";

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
  it("names the uncovered use that blocks a binding's covered uses", () => {
    const result = rewriteFiles({ root: repoRoot, files: [blockedPath] });
    const text = readRepoFile(blockedPath);
    const blocker = { v3Symbol: "Either.getOrNull", line: lineOf(text, "export const value") };
    const isLeft = result.leftovers.find((leftover) => leftover.v3Symbol === "Either.isLeft");
    expect(isLeft?.blockedBy).toEqual(blocker);
    const getOrNull = result.leftovers.find((l) => l.v3Symbol === "Either.getOrNull");
    expect(getOrNull?.blockedBy).toBeNull();
  });

  it("reports no leftover for a symbol whose v4 name is unchanged, in its v4 call shape", () => {
    const result = rewriteFiles({ root: repoRoot, files: [v4ShapedPath] });
    const file = onlyFile(result, v4ShapedPath);
    expect(file.after).toBe(file.before);
    expect(result.leftovers).toEqual([]);
  });

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
        blockedBy: null,
      },
    ]);
  });
});

describe("effect4 codemod report: a use already in its reference target's shape", () => {
  const referenceLine = 14692;
  const setReferenceLine = 14750;
  const header = 'import { Schema } from "effect";';

  /** The leftovers of one inline source, written to a scratch root and run through the codemod. */
  function leftoversOf(statement: string): CodemodResult["leftovers"] {
    const root = mkdtempSync(join(tmpdir(), "effect4-report-"));
    try {
      writeFileSync(join(root, "input.ts"), `${header}\n${statement}\n`);
      return rewriteFiles({ root, files: ["input.ts"] }).leftovers;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("reports no leftover for Schema.ReadonlySet inside Schema.toCodecJson", () => {
    const statement =
      "export const PathSet = Schema.toCodecJson(Schema.ReadonlySet(Schema.String));";
    expect(leftoversOf(statement)).toEqual([]);
  });

  it("still reports a bare Schema.ReadonlySet, with its reference line", () => {
    const statement = "export const PathSet = Schema.ReadonlySet(Schema.String);";
    expect(leftoversOf(statement)).toMatchObject([
      { v3Symbol: "Schema.ReadonlySet", line: 2, referenceLine },
    ]);
  });

  it("still reports Schema.Set inside Schema.toCodecJson, with its reference line", () => {
    const statement = "export const PathSet = Schema.toCodecJson(Schema.Set(Schema.String));";
    expect(leftoversOf(statement)).toMatchObject([
      { v3Symbol: "Schema.Set", line: 2, referenceLine: setReferenceLine },
    ]);
  });

  it("still reports Schema.ReadonlySet inside some other call", () => {
    const statement = "export const PathSet = Schema.optional(Schema.ReadonlySet(Schema.String));";
    expect(leftoversOf(statement)).toMatchObject([{ v3Symbol: "Schema.ReadonlySet", line: 2 }]);
  });
});
