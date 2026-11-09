// A write run of the codemod measures the type errors before and after its rewrites and
// prints both, through the measure it is given: here a counter returning distinct numbers,
// on a scratch tree with a tsconfig.json and one rewrite to make.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../scripts/effect4-codemod/main.js";
import { removeTempDir } from "../helpers/tempGit.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) removeTempDir(root);
});

describe("codemod:effect4 write run", () => {
  it("prints the counts measured before and after its rewrites", () => {
    const root = mkdtempSync(join(tmpdir(), "phax-effect4-run-"));
    roots.push(root);
    writeFileSync(join(root, "tsconfig.json"), "{}\n");
    mkdirSync(join(root, "src"));
    const source = [
      'import { Effect } from "effect";',
      "export const recovered = Effect.fail(1).pipe(Effect.catchAll(() => Effect.succeed(0)));",
      "",
    ].join("\n");
    writeFileSync(join(root, "src/a.ts"), source);

    const measured = [
      { src: 7, tests: 9 },
      { src: 2, tests: 4 },
    ];
    let out = "";
    const status = run(["--root", root], {
      measure: () => measured.shift() ?? { src: -1, tests: -1 },
      runTests: () => {
        throw new Error("a write run never runs the suites");
      },
      stdout: (text) => {
        out += text;
      },
      stderr: () => {},
    });

    expect(status).toBe(0);
    expect(measured).toEqual([]);
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toContain("Effect.catch(");
    expect(out).toContain(
      [
        "type errors   before  after",
        "src                7      2",
        "tests              9      4",
      ].join("\n"),
    );
  });
});
