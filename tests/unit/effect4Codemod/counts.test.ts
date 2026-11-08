// The type-error counts: recorded `tsc --pretty false` output in, `src` and `tests` counts out.
import { describe, expect, it } from "vitest";
import {
  countsFrom,
  measureCounts,
  NO_FILE,
  parseTscErrors,
  SRC_ARGS,
  TESTS_ARGS,
  typeErrorTable,
  type Runner,
} from "../../../scripts/effect4-codemod/counts.js";

const clean = "";

const srcOnly = `src/app/run.ts(12,5): error TS2339: Property 'either' does not exist on type 'typeof Effect'.
src/app/run.ts(40,9): error TS2724: '"effect"' has no exported member named 'Either'.
src/infra/git.ts(7,1): error TS2305: Module '"effect"' has no exported member 'ParseResult'.
`;

const testsOnly = `tests/unit/app/run.test.ts(3,10): error TS2305: Module '"effect"' has no exported member 'Either'.
packages/schemas/src/index.ts(1,1): error TS2307: Cannot find module 'effect/Schema'.
`;

// The test project includes `src`, so its output repeats src's errors.
const mixed = `src/app/run.ts(12,5): error TS2339: Property 'either' does not exist on type 'typeof Effect'.
src/infra/git.ts(7,1): error TS2305: Module '"effect"' has no exported member 'ParseResult'.
tests/unit/app/run.test.ts(3,10): error TS2305: Module '"effect"' has no exported member 'Either'.
tests/unit/app/run.test.ts(9,3): error TS2339: Property 'left' does not exist on type 'Result'.
site/theme/index.tsx(4,2): error TS2322: Type 'string' is not assignable to type 'number'.
`;

const multiLine = `src/app/run.ts(20,3): error TS2345: Argument of type '{ a: number; }' is not assignable to parameter of type 'Schema<string>'.
  Types of property 'a' are incompatible.
    Type 'number' is not assignable to type 'string'.
      error TS9999: a continuation line that only mentions an error
tests/unit/app/run.test.ts(5,1): error TS2322: Type 'Either<number, string>' is not assignable to type 'Result<number, string>'.
  The types returned by 'left()' are incompatible between these types.
`;

describe("parseTscErrors", () => {
  it("counts nothing in clean output", () => {
    expect(parseTscErrors(clean).size).toBe(0);
  });

  it("counts errors by file", () => {
    expect([...parseTscErrors(mixed)]).toEqual([
      ["src/app/run.ts", 1],
      ["src/infra/git.ts", 1],
      ["tests/unit/app/run.test.ts", 2],
      ["site/theme/index.tsx", 1],
    ]);
  });

  it("counts a multi-line diagnostic once", () => {
    expect([...parseTscErrors(multiLine)]).toEqual([
      ["src/app/run.ts", 1],
      ["tests/unit/app/run.test.ts", 1],
    ]);
  });

  it("counts a diagnostic that names no file", () => {
    expect([...parseTscErrors("error TS18003: No inputs were found in config file.\n")]).toEqual([
      [NO_FILE, 1],
    ]);
  });

  it("reads Windows line endings and separators", () => {
    const output = "src\\a.ts(1,1): error TS1005: x\r\nsrc\\a.ts(2,1): error TS1005: y\r\n";
    expect([...parseTscErrors(output)]).toEqual([["src/a.ts", 2]]);
  });
});

describe("countsFrom", () => {
  it("is zero and zero for clean output", () => {
    expect(countsFrom(clean, clean)).toEqual({ src: 0, tests: 0 });
  });

  it("counts src errors on the src side only", () => {
    expect(countsFrom(srcOnly, clean)).toEqual({ src: 3, tests: 0 });
  });

  it("counts tests errors outside src/ on the tests side only", () => {
    expect(countsFrom(clean, testsOnly)).toEqual({ src: 0, tests: 2 });
  });

  it("does not count the test project's src errors twice", () => {
    expect(countsFrom(srcOnly, mixed)).toEqual({ src: 3, tests: 3 });
  });

  it("counts a multi-line diagnostic once on each side", () => {
    expect(countsFrom(multiLine, multiLine)).toEqual({ src: 2, tests: 1 });
  });
});

describe("measureCounts", () => {
  it("runs the two tsc projects from the root through the injected runner", () => {
    const calls: Array<{ command: string; args: ReadonlyArray<string>; cwd: string }> = [];
    const run: Runner = (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return args.includes("tsconfig.test.json") ? mixed : srcOnly;
    };
    expect(measureCounts("/repo", run)).toEqual({ src: 3, tests: 3 });
    expect(calls).toEqual([
      { command: "/repo/node_modules/.bin/tsc", args: SRC_ARGS, cwd: "/repo" },
      { command: "/repo/node_modules/.bin/tsc", args: TESTS_ARGS, cwd: "/repo" },
    ]);
    expect(SRC_ARGS).toEqual(["--noEmit", "-p", "tsconfig.json", "--pretty", "false"]);
    expect(TESTS_ARGS).toEqual(["--noEmit", "-p", "tsconfig.test.json", "--pretty", "false"]);
  });
});

describe("typeErrorTable", () => {
  it("prints before and after for src and tests", () => {
    expect(typeErrorTable({ src: 0, tests: 12 }, { src: 140, tests: 9 })).toEqual([
      "type errors   before  after",
      "src                0    140",
      "tests             12      9",
    ]);
  });
});
