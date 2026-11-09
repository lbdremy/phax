// The test ratchet of the Effect 4 migration: the unit and integration tests that pass,
// held from one phase to the next alongside the type-error counts (see ratchet.ts).
//
// The record lives in PASSING_TESTS_FILE: an object from repository-relative POSIX test
// file to the sorted full names of its passing tests, keys sorted. A test is its file and
// its full name, `[...ancestorTitles, title].join(" > ")` from vitest's JSON reporter.
// The base of a phase is that file as committed at `HEAD`, never the working tree's copy.
//
//   no record at HEAD   record: the measured passing tests are written
//   every recorded test passed   pass: the measured passing set is the next record
//   a recorded test failed, skipped or missing   fail: nothing is written
//
// A name that occurs several times in one file passes only when every occurrence passed.
// When the verdict fails on failed recorded tests alone, the files holding them run once
// more, and a recorded test that passes on that rerun counts as passed (a flaky notice).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

export const PASSING_TESTS_FILE = "scripts/effect4-codemod/passing-tests.json";

/** Repository-relative POSIX test file to the sorted full names of its passing tests. */
export type TestRecord = { readonly [file: string]: ReadonlyArray<string> };

export type TestStatus = "passed" | "failed" | "skipped";

/** One test of a vitest run, as the JSON reporter reports it. */
export type TestOutcome = {
  readonly file: string;
  readonly name: string;
  readonly status: TestStatus;
};

/** A test's identity: its file and its full name. */
export type TestId = { readonly file: string; readonly name: string };

export type TestVerdict =
  | { readonly kind: "record" }
  | { readonly kind: "pass"; readonly added: ReadonlyArray<TestId> }
  | {
      readonly kind: "fail";
      readonly failed: ReadonlyArray<TestId>;
      readonly skipped: ReadonlyArray<TestId>;
      readonly missing: ReadonlyArray<TestId>;
    };

export type TestJudgement = {
  readonly verdict: TestVerdict;
  /** The measured passing set: names that passed in every occurrence. */
  readonly next: TestRecord;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The record file's JSON, narrowed by hand: an object whose keys are non-empty file paths
 * and whose values are lists of distinct strings. The lists come back sorted.
 */
export function toTestRecord(value: unknown): TestRecord | null {
  if (!isRecord(value)) return null;
  const entries: Array<[string, ReadonlyArray<string>]> = [];
  for (const [file, names] of Object.entries(value)) {
    if (file === "" || !Array.isArray(names)) return null;
    const strings: Array<string> = [];
    for (const name of names) {
      if (typeof name !== "string") return null;
      strings.push(name);
    }
    if (new Set(strings).size !== strings.length) return null;
    entries.push([file, strings.toSorted(byCodeUnit)]);
  }
  return Object.fromEntries(entries);
}

export function serializeTestRecord(record: TestRecord): string {
  const sorted = Object.fromEntries(
    Object.keys(record)
      .toSorted(byCodeUnit)
      .map((file) => [file, (record[file] ?? []).toSorted(byCodeUnit)]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The number of tests a record holds. */
export function recordSize(record: TestRecord): number {
  return Object.values(record).reduce((sum, names) => sum + names.length, 0);
}

export type TestBase =
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly record: TestRecord }
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "unreadable"; readonly reason: string };

function git(
  root: string,
  args: ReadonlyArray<string>,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.error === undefined ? (result.stderr ?? "") : result.error.message,
  };
}

/** The record committed at HEAD. A path HEAD does not hold is `none`; the working tree is never read. */
export function readTestBase(root: string): TestBase {
  const inside = git(root, ["rev-parse", "--git-dir"]);
  if (!inside.ok) return { kind: "unreadable", reason: `${root} is not a git repository` };
  // An unborn HEAD (no commit yet) holds no file either.
  if (!git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).ok) return { kind: "none" };
  const listed = git(root, ["ls-tree", "--name-only", "HEAD", "--", PASSING_TESTS_FILE]);
  if (!listed.ok)
    return { kind: "unreadable", reason: `git ls-tree failed: ${listed.stderr.trim()}` };
  if (listed.stdout.trim() === "") return { kind: "none" };
  const shown = git(root, ["show", `HEAD:${PASSING_TESTS_FILE}`]);
  if (!shown.ok) return { kind: "unreadable", reason: `git show failed: ${shown.stderr.trim()}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(shown.stdout);
  } catch {
    return { kind: "malformed", reason: `${PASSING_TESTS_FILE} at HEAD is not valid JSON` };
  }
  const record = toTestRecord(parsed);
  return record === null
    ? {
        kind: "malformed",
        reason: `${PASSING_TESTS_FILE} at HEAD is not an object from file to a list of distinct test names`,
      }
    : { kind: "found", record };
}

/** vitest's pending, todo and disabled tests are skipped. */
const STATUS_OF: { readonly [status: string]: TestStatus } = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
  pending: "skipped",
  todo: "skipped",
  disabled: "skipped",
};

function stringList(value: unknown): Array<string> | null {
  if (!Array.isArray(value)) return null;
  const strings: Array<string> = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    strings.push(item);
  }
  return strings;
}

function refuse(why: string): never {
  throw new Error(`the vitest report is not a JSON reporter report: ${why}`);
}

/**
 * The tests of a vitest JSON report. `testResults[].name` is absolute and comes back
 * relative to `root`, in POSIX form. A file that failed to load has no assertion results,
 * so it contributes no tests. Text that is not such a report throws: it never reads as
 * zero tests.
 */
export function parseVitestJson(text: string, root: string): Array<TestOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`the vitest report is not JSON: ${text.slice(0, 200)}`);
  }
  if (!isRecord(parsed)) return refuse("not an object");
  const results = parsed["testResults"];
  if (!Array.isArray(results)) return refuse("no testResults list");
  const outcomes: Array<TestOutcome> = [];
  for (const result of results) {
    if (!isRecord(result)) return refuse("a testResults entry is not an object");
    const absolute = result["name"];
    const assertions = result["assertionResults"];
    if (typeof absolute !== "string" || !isAbsolute(absolute))
      return refuse("a testResults entry has no absolute name");
    if (!Array.isArray(assertions)) return refuse(`${absolute} has no assertionResults list`);
    const file = relative(root, absolute).replaceAll("\\", "/");
    if (file === "" || file.startsWith("../") || isAbsolute(file))
      return refuse(`${absolute} is outside ${root}`);
    for (const assertion of assertions) {
      if (!isRecord(assertion)) return refuse(`an assertion of ${file} is not an object`);
      const ancestors = stringList(assertion["ancestorTitles"]);
      const title = assertion["title"];
      const status = assertion["status"];
      if (ancestors === null || typeof title !== "string" || typeof status !== "string")
        return refuse(`an assertion of ${file} lacks ancestorTitles, title or status`);
      const mapped = STATUS_OF[status];
      if (mapped === undefined) return refuse(`${file} reports an unknown status "${status}"`);
      outcomes.push({ file, name: [...ancestors, title].join(" > "), status: mapped });
    }
  }
  return outcomes;
}

const keyOf = (id: TestId): string => JSON.stringify([id.file, id.name]);

const compareIds = (a: TestId, b: TestId): number =>
  byCodeUnit(a.file, b.file) || byCodeUnit(a.name, b.name);

/** Each (file, name) once: failed when any occurrence failed, then skipped, else passed. */
function settled(measured: ReadonlyArray<TestOutcome>): Map<string, TestOutcome> {
  const rank: { readonly [status in TestStatus]: number } = { passed: 0, skipped: 1, failed: 2 };
  const byKey = new Map<string, TestOutcome>();
  for (const outcome of measured) {
    const key = keyOf(outcome);
    const seen = byKey.get(key);
    if (seen === undefined || rank[outcome.status] > rank[seen.status]) byKey.set(key, outcome);
  }
  return byKey;
}

function idsOf(record: TestRecord): Array<TestId> {
  return Object.entries(record).flatMap(([file, names]) => names.map((name) => ({ file, name })));
}

/** `base` null means no record committed yet: the measured passing set is the first. */
export function judgeTests(
  base: TestRecord | null,
  measured: ReadonlyArray<TestOutcome>,
): TestJudgement {
  const tests = settled(measured);
  const passing = [...tests.values()]
    .filter((test) => test.status === "passed")
    .map(({ file, name }) => ({ file, name }))
    .toSorted(compareIds);
  const files = new Map<string, Array<string>>();
  for (const { file, name } of passing) files.set(file, [...(files.get(file) ?? []), name]);
  const next: TestRecord = Object.fromEntries(files);
  if (base === null) return { verdict: { kind: "record" }, next };
  const recorded = idsOf(base).toSorted(compareIds);
  const recordedKeys = new Set(recorded.map(keyOf));
  const failed: Array<TestId> = [];
  const skipped: Array<TestId> = [];
  const missing: Array<TestId> = [];
  for (const id of recorded) {
    const status = tests.get(keyOf(id))?.status;
    if (status === undefined) missing.push(id);
    else if (status === "failed") failed.push(id);
    else if (status === "skipped") skipped.push(id);
  }
  if (failed.length + skipped.length + missing.length > 0)
    return { verdict: { kind: "fail", failed, skipped, missing }, next };
  const added = passing.filter((id) => !recordedKeys.has(keyOf(id)));
  return { verdict: { kind: "pass", added }, next };
}

/**
 * Runs the unit and integration suites of `root` (only `files`, repository-relative, when
 * given) and returns the text of vitest's JSON report.
 */
export type TestRunner = (root: string, files: ReadonlyArray<string> | null) => string;

export type VitestRunnerOptions = {
  /** The vitest binary; `<root>/node_modules/.bin/vitest` by default. */
  readonly binary?: string;
};

/** The arguments of a run, before the report path and the files. */
export const VITEST_ARGS = [
  "run",
  "--project",
  "unit",
  "--project",
  "integration",
  "--reporter=json",
] as const;

/**
 * The runner phax uses: vitest's CLI in a subprocess, with the root's own vitest config.
 * vitest exits non-zero when a test fails, so a non-zero exit with a report is expected;
 * a run that leaves no readable report (a crash, a config error) throws, rather than read
 * as zero tests and let the ratchet pass.
 */
export function vitestRunner(
  root: string,
  files: ReadonlyArray<string> | null,
  options: VitestRunnerOptions = {},
): string {
  const binary = options.binary ?? join(root, "node_modules/.bin/vitest");
  const directory = mkdtempSync(join(tmpdir(), "phax-test-ratchet-"));
  const report = join(directory, "report.json");
  const args = [...VITEST_ARGS, `--outputFile=${report}`, ...(files ?? [])];
  try {
    const result = spawnSync(binary, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: 60 * 60 * 1000,
    });
    if (result.error !== undefined) throw result.error;
    if (result.status === null) throw new Error(`${binary} was stopped by ${result.signal}`);
    let text: string;
    try {
      text = readFileSync(report, "utf8");
    } catch {
      throw new Error(
        `${binary} ${args.join(" ")} exited ${result.status} and wrote no report:\n${`${result.stdout}${result.stderr}`.slice(0, 2000)}`,
      );
    }
    return text;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export type TestCheck = {
  readonly judgement: TestJudgement;
  /** Recorded tests that failed, then passed on the rerun. */
  readonly flaky: ReadonlyArray<TestId>;
};

/**
 * Runs the suites, judges them against `base`, and applies the rerun rule: when the
 * verdict fails on failed recorded tests alone, their files run once more, and a recorded
 * test that passes in every occurrence of the rerun counts as passed.
 */
export function checkTests(root: string, base: TestRecord | null, run: TestRunner): TestCheck {
  // vitest names files by the real path of its working directory.
  const from = realpathSync(root);
  const measured = parseVitestJson(run(root, null), from);
  const first = judgeTests(base, measured);
  const verdict = first.verdict;
  if (
    verdict.kind !== "fail" ||
    verdict.failed.length === 0 ||
    verdict.skipped.length > 0 ||
    verdict.missing.length > 0
  )
    return { judgement: first, flaky: [] };
  const files = [...new Set(verdict.failed.map((id) => id.file))].toSorted(byCodeUnit);
  const rerun = settled(parseVitestJson(run(root, files), from));
  const flaky = verdict.failed.filter((id) => rerun.get(keyOf(id))?.status === "passed");
  if (flaky.length === 0) return { judgement: first, flaky };
  const flakyKeys = new Set(flaky.map(keyOf));
  const settledRun = measured.map(
    (outcome): TestOutcome =>
      flakyKeys.has(keyOf(outcome)) ? { ...outcome, status: "passed" } : outcome,
  );
  return { judgement: judgeTests(base, settledRun), flaky };
}
