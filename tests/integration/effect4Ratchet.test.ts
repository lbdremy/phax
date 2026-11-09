// The ratchet against a temporary git repository: its bases are the counts file and the
// passing-tests record at HEAD, whatever the working tree says. The suites never run here:
// each test injects recorded vitest reports.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PASSING_TESTS_FILE, type TestRunner } from "../../scripts/effect4-codemod/passingTests.js";
import { RATCHET_FILE, runRatchet } from "../../scripts/effect4-codemod/ratchet.js";

let root = "";

const FILE = "tests/unit/a.test.ts";

function git(...args: Array<string>): void {
  const run = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
}

function writeAt(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function writeText(text: string): void {
  writeAt(RATCHET_FILE, text);
}

function writeCounts(src: number, tests: number): void {
  writeText(`{\n  "src": ${src},\n  "tests": ${tests}\n}\n`);
}

function writeTests(record: Record<string, ReadonlyArray<string>>): void {
  writeAt(PASSING_TESTS_FILE, `${JSON.stringify(record, null, 2)}\n`);
}

function commitAll(): void {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base");
}

type Status = "passed" | "failed" | "skipped" | "todo";

/** A vitest JSON report of `tests` (`name` or `outer > name`) in FILE under the root. */
function report(tests: ReadonlyArray<readonly [string, Status]>, file = FILE): string {
  return JSON.stringify({
    success: false,
    testResults: [
      {
        name: join(root, file),
        status: "passed",
        message: "",
        assertionResults: tests.map(([name, status]) => {
          const titles = name.split(" > ");
          return { ancestorTitles: titles.slice(0, -1), title: titles.at(-1), status };
        }),
      },
    ],
  });
}

/** A runner answering `reports` in order, recording the files each call asked for. */
function recorded(
  reports: ReadonlyArray<string>,
  calls: Array<ReadonlyArray<string> | null> = [],
): TestRunner {
  const queue = [...reports];
  return (_root, files) => {
    calls.push(files);
    const next = queue.shift();
    if (next === undefined) throw new Error("the suites ran more often than expected");
    return next;
  };
}

/** One passing test, `a`. */
const green = (): TestRunner => recorded([report([["a", "passed"]])]);

function ratchet(
  src: number,
  tests: number,
  runTests: TestRunner = green(),
): { status: number; output: string } {
  let output = "";
  const status = runRatchet(root, {
    measure: () => ({ src, tests }),
    runTests,
    write: (text) => {
      output += text;
    },
  });
  return { status, output };
}

function counts(): string {
  return readFileSync(join(root, RATCHET_FILE), "utf8");
}

function passing(): string {
  return readFileSync(join(root, PASSING_TESTS_FILE), "utf8");
}

beforeEach(() => {
  // vitest names files by the real path, so the root is one too (macOS's /var is a link).
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-effect4-ratchet-")));
  git("init", "-q");
  writeFileSync(join(root, "README.md"), "x\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runRatchet", () => {
  it("fails, measuring nothing, when a phase changed package.json scripts", () => {
    writeFileSync(join(root, "package.json"), '{ "scripts": { "test": "vitest run" } }\n');
    commitAll();
    writeFileSync(join(root, "package.json"), '{ "scripts": { "test": "true" } }\n');
    let measured = false;
    const calls: Array<ReadonlyArray<string> | null> = [];
    let output = "";
    const status = runRatchet(root, {
      measure: () => {
        measured = true;
        return { src: 0, tests: 0 };
      },
      runTests: recorded([], calls),
      write: (text) => {
        output += text;
      },
    });
    expect(status).toBe(1);
    expect(measured).toBe(false);
    expect(calls).toEqual([]);
    expect(output).toContain("package.json scripts differ from HEAD");
  });

  it("passes when only package.json dependencies changed", () => {
    writeFileSync(join(root, "package.json"), '{ "scripts": { "test": "vitest run" } }\n');
    commitAll();
    writeFileSync(
      join(root, "package.json"),
      '{ "scripts": { "test": "vitest run" }, "dependencies": { "effect": "4.1.2" } }\n',
    );
    expect(ratchet(3, 4).status).toBe(0);
  });

  it("records the first counts and passes when HEAD has no counts file", () => {
    commitAll();
    const { status, output } = ratchet(140, 12);
    expect(status).toBe(0);
    expect(output).toContain("recorded the first counts");
    expect(counts()).toBe('{\n  "src": 140,\n  "tests": 12\n}\n');
  });

  it("records the first counts when the repository has no commit yet", () => {
    expect(ratchet(5, 6).status).toBe(0);
    expect(counts()).toBe('{\n  "src": 5,\n  "tests": 6\n}\n');
  });

  it("passes at the base and writes the measured counts", () => {
    writeCounts(10, 20);
    commitAll();
    expect(ratchet(10, 20).status).toBe(0);
    expect(counts()).toBe('{\n  "src": 10,\n  "tests": 20\n}\n');
  });

  it("passes under the base and lowers the recorded counts", () => {
    writeCounts(10, 20);
    commitAll();
    const { status, output } = ratchet(4, 20);
    expect(status).toBe(0);
    expect(output).toContain("passed");
    expect(counts()).toBe('{\n  "src": 4,\n  "tests": 20\n}\n');
  });

  it.each([
    ["src", 11, 20],
    ["tests", 10, 21],
  ])("fails above the base on %s, runs no suite and writes nothing", (name, src, tests) => {
    writeCounts(10, 20);
    commitAll();
    const calls: Array<ReadonlyArray<string> | null> = [];
    const { status, output } = ratchet(src, tests, recorded([], calls));
    expect(status).toBe(1);
    expect(output).toContain(`failed, ${name} above the base`);
    expect(output).not.toContain("tests  recorded");
    expect(calls).toEqual([]);
    expect(counts()).toBe('{\n  "src": 10,\n  "tests": 20\n}\n');
    expect(existsSync(join(root, PASSING_TESTS_FILE))).toBe(false);
  });

  it("still compares against HEAD after the working-tree file is raised", () => {
    writeCounts(10, 20);
    commitAll();
    writeCounts(500, 500);
    expect(ratchet(11, 20).status).toBe(1);
    expect(counts()).toBe('{\n  "src": 500,\n  "tests": 500\n}\n');
  });

  it("still compares against HEAD after the working-tree file is deleted", () => {
    writeCounts(10, 20);
    commitAll();
    rmSync(join(root, RATCHET_FILE));
    expect(ratchet(11, 20).status).toBe(1);
    expect(existsSync(join(root, RATCHET_FILE))).toBe(false);
  });

  it("does not take a working-tree file that HEAD lacks as a base", () => {
    commitAll();
    writeCounts(1, 1);
    expect(ratchet(50, 50).status).toBe(0);
    expect(counts()).toBe('{\n  "src": 50,\n  "tests": 50\n}\n');
  });

  it("fails on a malformed counts file at HEAD without measuring or writing", () => {
    writeText('{ "src": "many" }\n');
    commitAll();
    writeCounts(0, 0);
    let measured = false;
    let output = "";
    const status = runRatchet(root, {
      measure: () => {
        measured = true;
        return { src: 0, tests: 0 };
      },
      runTests: recorded([]),
      write: (text) => {
        output += text;
      },
    });
    expect(status).toBe(1);
    expect(measured).toBe(false);
    expect(output).toContain("is not");
    expect(counts()).toBe('{\n  "src": 0,\n  "tests": 0\n}\n');
  });

  it("fails outside a git repository", () => {
    const bare = mkdtempSync(join(tmpdir(), "phax-effect4-nogit-"));
    try {
      const status = runRatchet(bare, {
        measure: () => ({ src: 0, tests: 0 }),
        runTests: recorded([]),
        write: () => {},
      });
      expect(status).toBe(1);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("runRatchet's test record", () => {
  it("records both files the first time, sorted", () => {
    commitAll();
    const runTests = recorded([
      report([
        ["outer > b", "passed"],
        ["a", "passed"],
        ["c", "failed"],
        ["d", "todo"],
      ]),
    ]);
    const { status, output } = ratchet(3, 4, runTests);
    expect(status).toBe(0);
    expect(counts()).toBe('{\n  "src": 3,\n  "tests": 4\n}\n');
    expect(passing()).toBe(`{\n  "${FILE}": [\n    "a",\n    "outer > b"\n  ]\n}\n`);
    expect(output).toBe(
      [
        "type errors   base  measured",
        "src       -         3",
        "tests     -         4",
        "tests  recorded -  passing 2  added 2",
        `ratchet: recorded the first counts in ${RATCHET_FILE} and the first passing tests in ${PASSING_TESTS_FILE}`,
        "",
      ].join("\n"),
    );
  });

  it("records the first passing tests beside counts that already exist", () => {
    writeCounts(3, 4);
    commitAll();
    const { status, output } = ratchet(3, 4);
    expect(status).toBe(0);
    expect(output).toContain(
      `ratchet: passed, recorded the counts in ${RATCHET_FILE} and the first passing tests in ${PASSING_TESTS_FILE}\n`,
    );
    expect(passing()).toBe(`{\n  "${FILE}": [\n    "a"\n  ]\n}\n`);
  });

  it("passes and adds a test passing for the first time", () => {
    writeCounts(3, 4);
    writeTests({ [FILE]: ["a"] });
    commitAll();
    const runTests = recorded([
      report([
        ["a", "passed"],
        ["b", "passed"],
      ]),
    ]);
    const { status, output } = ratchet(3, 4, runTests);
    expect(status).toBe(0);
    expect(output).toContain("tests  recorded 1  passing 2  added 1\n");
    expect(output).toContain(
      `ratchet: passed, recorded the counts in ${RATCHET_FILE} and the passing tests in ${PASSING_TESTS_FILE}\n`,
    );
    expect(passing()).toBe(`{\n  "${FILE}": [\n    "a",\n    "b"\n  ]\n}\n`);
  });

  it("fails on a failed, a skipped and a missing recorded test, rerunning nothing and writing nothing", () => {
    writeCounts(3, 4);
    writeTests({ [FILE]: ["failing", "kept", "skipped", "gone"] });
    commitAll();
    const calls: Array<ReadonlyArray<string> | null> = [];
    const runTests = recorded(
      [
        report([
          ["failing", "failed"],
          ["kept", "passed"],
          ["skipped", "skipped"],
          ["new", "passed"],
        ]),
      ],
      calls,
    );
    const { status, output } = ratchet(2, 4, runTests);
    expect(status).toBe(1);
    expect(calls).toEqual([null]);
    expect(output).toBe(
      [
        "type errors   base  measured",
        "src       3         2",
        "tests     4         4",
        "tests  recorded 4  passing 2  added 0",
        `failed   ${FILE} > failing`,
        `skipped  ${FILE} > skipped`,
        `missing  ${FILE} > gone`,
        `ratchet: failed, 3 recorded tests failed, skipped or missing against ${PASSING_TESTS_FILE} at HEAD`,
        "",
      ].join("\n"),
    );
    expect(counts()).toBe('{\n  "src": 3,\n  "tests": 4\n}\n');
    expect(JSON.parse(passing())).toEqual({ [FILE]: ["failing", "kept", "skipped", "gone"] });
  });

  it("fails on a recorded test that fails on the rerun too", () => {
    writeCounts(3, 4);
    writeTests({ [FILE]: ["a"] });
    commitAll();
    const calls: Array<ReadonlyArray<string> | null> = [];
    const runTests = recorded([report([["a", "failed"]]), report([["a", "failed"]])], calls);
    const { status, output } = ratchet(3, 4, runTests);
    expect(status).toBe(1);
    expect(calls).toEqual([null, [FILE]]);
    expect(output).toContain(`failed   ${FILE} > a\n`);
    expect(output).not.toContain("flaky");
    expect(output).toContain("failed, 1 recorded test failed, skipped or missing");
  });

  it("passes a recorded test that passes on the rerun and reports it flaky", () => {
    writeCounts(3, 4);
    writeTests({ [FILE]: ["a", "b"] });
    commitAll();
    const calls: Array<ReadonlyArray<string> | null> = [];
    const runTests = recorded(
      [
        report([
          ["a", "failed"],
          ["b", "passed"],
        ]),
        report([
          ["a", "passed"],
          ["b", "passed"],
        ]),
      ],
      calls,
    );
    const { status, output } = ratchet(3, 4, runTests);
    expect(status).toBe(0);
    expect(calls).toEqual([null, [FILE]]);
    expect(output).toContain(`tests  recorded 2  passing 2  added 0\nflaky    ${FILE} > a\n`);
    expect(output).toContain("ratchet: passed");
    expect(JSON.parse(passing())).toEqual({ [FILE]: ["a", "b"] });
  });

  it("fails on a malformed record at HEAD without measuring, running or writing", () => {
    writeCounts(3, 4);
    writeAt(PASSING_TESTS_FILE, `{ "${FILE}": "a" }\n`);
    commitAll();
    let measured = false;
    const calls: Array<ReadonlyArray<string> | null> = [];
    let output = "";
    const status = runRatchet(root, {
      measure: () => {
        measured = true;
        return { src: 0, tests: 0 };
      },
      runTests: recorded([], calls),
      write: (text) => {
        output += text;
      },
    });
    expect(status).toBe(1);
    expect(measured).toBe(false);
    expect(calls).toEqual([]);
    expect(output).toBe(
      `ratchet: ${PASSING_TESTS_FILE} at HEAD is not an object from file to a list of distinct test names\n`,
    );
    expect(counts()).toBe('{\n  "src": 3,\n  "tests": 4\n}\n');
  });

  it("fails on a record at HEAD that is not JSON", () => {
    writeAt(PASSING_TESTS_FILE, "{ not json\n");
    commitAll();
    const { status, output } = ratchet(3, 4);
    expect(status).toBe(1);
    expect(output).toBe(`ratchet: ${PASSING_TESTS_FILE} at HEAD is not valid JSON\n`);
  });

  it("holds the tests to HEAD's record, not the working tree's", () => {
    writeCounts(3, 4);
    writeTests({ [FILE]: ["a", "b"] });
    commitAll();
    writeTests({ [FILE]: ["a"] });
    const runTests = recorded([report([["a", "passed"]])]);
    const { status, output } = ratchet(3, 4, runTests);
    expect(status).toBe(1);
    expect(output).toContain(`missing  ${FILE} > b\n`);
    expect(JSON.parse(passing())).toEqual({ [FILE]: ["a"] });
  });

  it("does not take a working-tree record that HEAD lacks as a base", () => {
    writeCounts(3, 4);
    commitAll();
    writeTests({ [FILE]: ["gone"] });
    const { status, output } = ratchet(3, 4);
    expect(status).toBe(0);
    expect(output).toContain("tests  recorded -  passing 1  added 1\n");
    expect(passing()).toBe(`{\n  "${FILE}": [\n    "a"\n  ]\n}\n`);
  });

  it("throws on a run that leaves no report it can read, writing nothing", () => {
    writeCounts(3, 4);
    commitAll();
    expect(() => ratchet(1, 1, recorded(["Error: vitest crashed"]))).toThrow(/vitest report/);
    expect(counts()).toBe('{\n  "src": 3,\n  "tests": 4\n}\n');
    expect(existsSync(join(root, PASSING_TESTS_FILE))).toBe(false);
  });
});
