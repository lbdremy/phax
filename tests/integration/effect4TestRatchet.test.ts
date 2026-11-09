// The test ratchet's real runner against a fixture vitest project: vitest's CLI and JSON
// reporter report passed, failed and skipped tests, and a test that fails once passes on
// the rerun.
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkTests,
  parseVitestJson,
  vitestRunner,
  type TestRunner,
} from "../../scripts/effect4-codemod/passingTests.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixture = realpathSync(
  join(repoRoot, "tests/unit/effect4Codemod/__fixtures__/vitest-project"),
);
const binary = join(repoRoot, "node_modules/.bin/vitest");

/** The real runner on the fixture, recording which files each run asked for. */
function runner(calls: Array<ReadonlyArray<string> | null>): TestRunner {
  return (root, files) => {
    calls.push(files);
    return vitestRunner(root, files, { binary });
  };
}

let scratch = "";
let previousMark: string | undefined;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "phax-test-ratchet-smoke-"));
  previousMark = process.env["PHAX_RATCHET_FLAKY_MARK"];
  process.env["PHAX_RATCHET_FLAKY_MARK"] = join(scratch, "flaky-mark");
});

afterEach(() => {
  if (previousMark === undefined) delete process.env["PHAX_RATCHET_FLAKY_MARK"];
  else process.env["PHAX_RATCHET_FLAKY_MARK"] = previousMark;
  rmSync(scratch, { recursive: true, force: true });
});

const sorted = (outcomes: ReadonlyArray<{ file: string; name: string; status: string }>) =>
  outcomes.toSorted((a, b) =>
    a.file === b.file ? (a.name < b.name ? -1 : 1) : a.file < b.file ? -1 : 1,
  );

describe("vitestRunner", () => {
  it("reports the unit and integration projects' passed, failed and skipped tests", () => {
    const outcomes = parseVitestJson(vitestRunner(fixture, null, { binary }), fixture);
    expect(sorted(outcomes)).toEqual([
      { file: "failing.check.ts", name: "failing > always fails", status: "failed" },
      { file: "failing.check.ts", name: "failing > passes beside it", status: "passed" },
      { file: "flaky.check.ts", name: "passes the second time", status: "failed" },
      { file: "passing.check.ts", name: "adds", status: "passed" },
      { file: "passing.check.ts", name: "outer > inner > concatenates", status: "passed" },
      { file: "skipped.check.ts", name: "is skipped", status: "skipped" },
      { file: "skipped.check.ts", name: "is to do", status: "skipped" },
    ]);
    expect(existsSync(join(scratch, "flaky-mark"))).toBe(true);
  });

  it("runs only the files it is given", () => {
    const outcomes = parseVitestJson(
      vitestRunner(fixture, ["passing.check.ts"], { binary }),
      fixture,
    );
    expect(new Set(outcomes.map((outcome) => outcome.file))).toEqual(new Set(["passing.check.ts"]));
  });

  it("throws when vitest leaves no report", () => {
    expect(() =>
      vitestRunner(fixture, null, { binary: join(repoRoot, "node_modules/.bin/tsc") }),
    ).toThrow(/wrote no report/);
  });
});

describe("checkTests with the real runner", () => {
  it("passes a recorded test that fails once, rerunning only its file, and reports it flaky", () => {
    const calls: Array<ReadonlyArray<string> | null> = [];
    const base = {
      "flaky.check.ts": ["passes the second time"],
      "passing.check.ts": ["adds", "outer > inner > concatenates"],
    };
    const { judgement, flaky } = checkTests(fixture, base, runner(calls));
    expect(calls).toEqual([null, ["flaky.check.ts"]]);
    expect(flaky).toEqual([{ file: "flaky.check.ts", name: "passes the second time" }]);
    expect(judgement.verdict).toEqual({
      kind: "pass",
      added: [{ file: "failing.check.ts", name: "failing > passes beside it" }],
    });
    expect(judgement.next).toEqual({
      "failing.check.ts": ["failing > passes beside it"],
      "flaky.check.ts": ["passes the second time"],
      "passing.check.ts": ["adds", "outer > inner > concatenates"],
    });
  });

  it("still fails a recorded test that fails on the rerun too", () => {
    const calls: Array<ReadonlyArray<string> | null> = [];
    const base = {
      "failing.check.ts": ["failing > always fails"],
      "flaky.check.ts": ["passes the second time"],
    };
    const { judgement, flaky } = checkTests(fixture, base, runner(calls));
    expect(calls).toEqual([null, ["failing.check.ts", "flaky.check.ts"]]);
    expect(flaky).toEqual([{ file: "flaky.check.ts", name: "passes the second time" }]);
    expect(judgement.verdict).toEqual({
      kind: "fail",
      failed: [{ file: "failing.check.ts", name: "failing > always fails" }],
      skipped: [],
      missing: [],
    });
  });

  it("does not rerun when a recorded test is skipped", () => {
    const calls: Array<ReadonlyArray<string> | null> = [];
    const base = {
      "flaky.check.ts": ["passes the second time"],
      "skipped.check.ts": ["is skipped"],
    };
    const { judgement, flaky } = checkTests(fixture, base, runner(calls));
    expect(calls).toEqual([null]);
    expect(flaky).toEqual([]);
    expect(judgement.verdict).toEqual({
      kind: "fail",
      failed: [{ file: "flaky.check.ts", name: "passes the second time" }],
      skipped: [{ file: "skipped.check.ts", name: "is skipped" }],
      missing: [],
    });
  });
});
