// What each rule of phax's Effect 4 codemod must do: rewrite its fixture's input to its
// expected output byte for byte (only the matched spans change), change nothing on a
// second run, and cite, for every mapping, the line of the vendored v3-to-v4.md that holds
// its v3 symbol's entry. Each expected output was derived from that line and its topic
// guide under docs/vendor/effect-migration/effect@4.1.2/.
//
// Acceptance tests passed by phase-05: every test is marked `.fails` until the codemod
// exists. Each test is written out, never generated, so its marker reads statically.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rewriteFiles, type CodemodResult } from "../../../scripts/effect4-codemod/codemod.js";
import { RULES } from "../../../scripts/effect4-codemod/rules.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rulesFixtures = "tests/unit/effect4Codemod/__fixtures__/rules";
const referencePath = "docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md";

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

/** Runs the codemod on a rule's input and checks it against the rule's expected output. */
function expectRewrite(ruleId: string): void {
  const inputPath = `${rulesFixtures}/${ruleId}/input.ts`;
  const file = onlyFile(rewriteFiles({ root: repoRoot, files: [inputPath] }), inputPath);
  expect(file.before).toBe(readRepoFile(inputPath));
  expect(file.after).toBe(readRepoFile(`${rulesFixtures}/${ruleId}/expected.ts`));
  expect(file.rewrites[ruleId] ?? 0).toBeGreaterThan(0);
}

/** Runs the codemod on a rule's rewritten output and checks it changes nothing. */
function expectSettled(ruleId: string): void {
  const expectedPath = `${rulesFixtures}/${ruleId}/expected.ts`;
  const file = onlyFile(rewriteFiles({ root: repoRoot, files: [expectedPath] }), expectedPath);
  expect(file.after).toBe(file.before);
  expect(file.before).toBe(readRepoFile(expectedPath));
  expect(totalRewrites(file)).toBe(0);
}

describe("effect4 codemod rules: each fixture rewrites to its expected output", () => {
  it("either-to-result rewrites its input to its expected output", () => {
    expectRewrite("either-to-result");
  });

  it("effect-either rewrites its input to its expected output", () => {
    expectRewrite("effect-either");
  });

  it("schema-decode-either rewrites its input to its expected output", () => {
    expectRewrite("schema-decode-either");
  });

  it("context-tag rewrites its input to its expected output", () => {
    expectRewrite("context-tag");
  });

  it("schema-filters rewrites its input to its expected output", () => {
    expectRewrite("schema-filters");
  });

  it("schema-optional-with rewrites its input to its expected output", () => {
    expectRewrite("schema-optional-with");
  });

  it("catch-all rewrites its input to its expected output", () => {
    expectRewrite("catch-all");
  });

  it("parse-result-issues rewrites its input to its expected output", () => {
    expectRewrite("parse-result-issues");
  });
});

describe("effect4 codemod rules: a rewritten file comes back unchanged", () => {
  it("either-to-result changes nothing in its own output", () => {
    expectSettled("either-to-result");
  });

  it("effect-either changes nothing in its own output", () => {
    expectSettled("effect-either");
  });

  it("schema-decode-either changes nothing in its own output", () => {
    expectSettled("schema-decode-either");
  });

  it("context-tag changes nothing in its own output", () => {
    expectSettled("context-tag");
  });

  it("schema-filters changes nothing in its own output", () => {
    expectSettled("schema-filters");
  });

  it("schema-optional-with changes nothing in its own output", () => {
    expectSettled("schema-optional-with");
  });

  it("catch-all changes nothing in its own output", () => {
    expectSettled("catch-all");
  });

  it("parse-result-issues changes nothing in its own output", () => {
    expectSettled("parse-result-issues");
  });
});

// The starting table, each line checked against the vendored reference when the fixtures
// were written. A rule may gain mappings; it may not lose or move one of these.
const PLANNED_MAPPINGS: ReadonlyArray<{
  readonly rule: string;
  readonly v3Symbol: string;
  readonly line: number;
}> = [
  { rule: "either-to-result", v3Symbol: "effect/Either", line: 689 },
  { rule: "either-to-result", v3Symbol: "Either.Either", line: 10395 },
  { rule: "either-to-result", v3Symbol: "Either.getOrElse", line: 10433 },
  { rule: "either-to-result", v3Symbol: "Either.isLeft", line: 10445 },
  { rule: "either-to-result", v3Symbol: "Either.isRight", line: 10447 },
  { rule: "either-to-result", v3Symbol: "Either.left", line: 10449 },
  { rule: "either-to-result", v3Symbol: "Either.map", line: 10453 },
  { rule: "either-to-result", v3Symbol: "Either.mapLeft", line: 10455 },
  { rule: "either-to-result", v3Symbol: "Either.match", line: 10457 },
  { rule: "either-to-result", v3Symbol: "Either.right", line: 10459 },
  { rule: "effect-either", v3Symbol: "Effect.either", line: 10057 },
  { rule: "schema-decode-either", v3Symbol: "Schema.decodeEither", line: 14950 },
  { rule: "schema-decode-either", v3Symbol: "Schema.decodeUnknownEither", line: 14954 },
  { rule: "schema-decode-either", v3Symbol: "Schema.encodeEither", line: 14970 },
  { rule: "schema-decode-either", v3Symbol: "Schema.encodeUnknownEither", line: 14974 },
  { rule: "schema-decode-either", v3Symbol: "ParseResult.decodeUnknownEither", line: 13130 },
  { rule: "context-tag", v3Symbol: "Context.Tag", line: 9639 },
  { rule: "context-tag", v3Symbol: "Context.GenericTag", line: 9629 },
  { rule: "schema-filters", v3Symbol: "Schema.filter", line: 14992 },
  { rule: "schema-optional-with", v3Symbol: "Schema.optionalWith", line: 15118 },
  { rule: "catch-all", v3Symbol: "Effect.catchAll", line: 10003 },
  { rule: "catch-all", v3Symbol: "Effect.orElse", line: 10189 },
  { rule: "parse-result-issues", v3Symbol: "effect/ParseResult", line: 720 },
  { rule: "parse-result-issues", v3Symbol: "ParseResult.Missing", line: 13088 },
  { rule: "parse-result-issues", v3Symbol: "ParseResult.ParseIssue", line: 13094 },
  { rule: "parse-result-issues", v3Symbol: "ParseResult.Type", line: 13118 },
  { rule: "parse-result-issues", v3Symbol: "ParseResult.Unexpected", line: 13120 },
];

describe("effect4 codemod rules: the rule table", () => {
  it("the rule ids are the rule fixture directories", () => {
    const directories = readdirSync(`${repoRoot}${rulesFixtures}`).toSorted();
    expect(RULES.map((rule) => rule.id).toSorted()).toEqual(directories);
  });

  it("every mapping's line in the vendored v3-to-v4.md holds its v3 symbol's entry", () => {
    const lines = readRepoFile(referencePath).split("\n");
    const mappings = RULES.flatMap((rule) =>
      rule.mappings.map((mapping) => ({ rule: rule.id, ...mapping })),
    );
    expect(mappings.length).toBeGreaterThan(0);
    const misplaced = mappings.filter(({ v3Symbol, line }) => {
      const text = lines[line - 1] ?? "";
      return !(text.startsWith(`- \`${v3Symbol}\` ->`) || text === `#### \`${v3Symbol}\``);
    });
    expect(misplaced).toEqual([]);
  });

  it("every planned mapping is in its rule, with its verified line", () => {
    const mappings = RULES.flatMap((rule) =>
      rule.mappings.map((mapping) => ({
        rule: rule.id,
        v3Symbol: mapping.v3Symbol,
        line: mapping.line,
      })),
    );
    for (const planned of PLANNED_MAPPINGS) expect(mappings).toContainEqual(planned);
  });
});
