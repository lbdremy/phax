// The error ratchet of the Effect 4 migration: `pnpm codemod:effect4 --ratchet`.
//
// The counts live in RATCHET_FILE. The base of a phase is that file as committed at
// `HEAD` (read with `git show`), never the working tree's copy: phax's gates run before
// it commits, so HEAD is the previous phase's result and the working tree may have been
// edited by the phase itself.
//
//   no file at HEAD   record: the measured counts are written, the run passes
//   counts at or under the base   pass: the measured counts are written for the next base
//   a count above its base   fail: nothing is written, exit 1
//   a file at HEAD that is not `{ src, tests }` of numbers   fail
//   package.json scripts that differ from HEAD's   fail, before anything is measured
//
// Once the counts pass, it runs the unit and integration suites and holds the passing
// tests to PASSING_TESTS_FILE at HEAD (see passingTests.ts). A count above its base fails
// before the suites run, and neither file is written unless both checks pass.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { measureCounts, type Counts } from "./counts.js";
import {
  checkTests,
  PASSING_TESTS_FILE,
  readTestBase,
  recordSize,
  serializeTestRecord,
  vitestRunner,
  type TestCheck,
  type TestId,
  type TestRecord,
  type TestRunner,
} from "./passingTests.js";

export const RATCHET_FILE = "scripts/effect4-codemod/type-error-counts.json";

export type Verdict =
  | { readonly kind: "record" }
  | { readonly kind: "pass" }
  | { readonly kind: "fail"; readonly exceeded: ReadonlyArray<keyof Counts> };

const COUNT_NAMES = ["src", "tests"] as const;

/** `base` null means no counts committed yet: the measured counts are the first. */
export function judge(base: Counts | null, measured: Counts): Verdict {
  if (base === null) return { kind: "record" };
  const exceeded = COUNT_NAMES.filter((name) => measured[name] > base[name]);
  return exceeded.length === 0 ? { kind: "pass" } : { kind: "fail", exceeded };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** The counts file's JSON, narrowed by hand: exactly `src` and `tests`, both counts. */
export function toCounts(value: unknown): Counts | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("src") || !keys.includes("tests")) return null;
  const { src, tests } = value;
  return isCount(src) && isCount(tests) ? { src, tests } : null;
}

export function serializeCounts(counts: Counts): string {
  return `${JSON.stringify({ src: counts.src, tests: counts.tests }, null, 2)}\n`;
}

export type Base =
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly counts: Counts }
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "unreadable"; readonly reason: string };

function git(
  root: string,
  args: ReadonlyArray<string>,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.error === undefined ? (result.stderr ?? "") : result.error.message,
  };
}

/** The counts committed at HEAD. A path HEAD does not hold is `none`; the working tree is never read. */
export function readBase(root: string): Base {
  const inside = git(root, ["rev-parse", "--git-dir"]);
  if (!inside.ok) return { kind: "unreadable", reason: `${root} is not a git repository` };
  // An unborn HEAD (no commit yet) holds no file either.
  if (!git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).ok) return { kind: "none" };
  const listed = git(root, ["ls-tree", "--name-only", "HEAD", "--", RATCHET_FILE]);
  if (!listed.ok)
    return { kind: "unreadable", reason: `git ls-tree failed: ${listed.stderr.trim()}` };
  if (listed.stdout.trim() === "") return { kind: "none" };
  const shown = git(root, ["show", `HEAD:${RATCHET_FILE}`]);
  if (!shown.ok) return { kind: "unreadable", reason: `git show failed: ${shown.stderr.trim()}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(shown.stdout);
  } catch {
    return { kind: "malformed", reason: `${RATCHET_FILE} at HEAD is not valid JSON` };
  }
  const counts = toCounts(parsed);
  return counts === null
    ? {
        kind: "malformed",
        reason: `${RATCHET_FILE} at HEAD is not { "src": number, "tests": number }`,
      }
    : { kind: "found", counts };
}

/**
 * Why the package's scripts at HEAD and in the working tree differ, or null when they do
 * not (or HEAD holds no package.json). A phase that changes a script can change what the
 * gate runs or counts (the ratchet's own command, the test command), so that is the
 * operator's edit, never a phase's; package.json itself stays editable for dependencies.
 */
export function scriptsChange(root: string): string | null {
  const shown = git(root, ["show", "HEAD:package.json"]);
  if (!shown.ok) return null;
  const scriptsOf = (text: string): string => {
    try {
      const parsed: unknown = JSON.parse(text);
      return JSON.stringify(isRecord(parsed) ? (parsed["scripts"] ?? null) : null);
    } catch {
      return "unreadable";
    }
  };
  let working: string;
  try {
    working = readFileSync(join(root, "package.json"), "utf8");
  } catch {
    return "package.json is missing from the working tree";
  }
  return scriptsOf(shown.stdout) === scriptsOf(working)
    ? null
    : "package.json scripts differ from HEAD: a phase may not change what the gate runs; that is the operator's edit";
}

export type RatchetOptions = {
  /** Measures the counts of `root`; `measureCounts` by default. */
  readonly measure?: (root: string) => Counts;
  /** Runs the unit and integration suites of `root`; `vitestRunner` by default. */
  readonly runTests?: TestRunner;
  /** Where the report goes; stdout by default. */
  readonly write?: (text: string) => void;
};

/** `failed   <file> > <name>`, one line per test. */
function named(kind: string, ids: ReadonlyArray<TestId>): Array<string> {
  return ids.map((id) => `${kind.padEnd(9)}${id.file} > ${id.name}`);
}

/** `tests  recorded <n>  passing <n>  added <n>`, then one line per test worth naming. */
function testLines(base: TestRecord | null, check: TestCheck): Array<string> {
  const { verdict, next } = check.judgement;
  const passing = recordSize(next);
  const added =
    verdict.kind === "pass" ? verdict.added.length : verdict.kind === "record" ? passing : 0;
  const lines = [
    `tests  recorded ${base === null ? "-" : recordSize(base)}  passing ${passing}  added ${added}`,
  ];
  if (verdict.kind === "fail") {
    lines.push(
      ...named("failed", verdict.failed),
      ...named("skipped", verdict.skipped),
      ...named("missing", verdict.missing),
    );
  }
  lines.push(...named("flaky", check.flaky));
  return lines;
}

function writeRecord(root: string, path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Runs the ratchet: 0 on record or pass, 1 on a failure. Both bases and the scripts guard
 * come first; then the type errors, and only when they pass, the suites. Both records are
 * written only when both checks pass (or record).
 */
export function runRatchet(root: string, options: RatchetOptions = {}): number {
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  const measure = options.measure ?? ((from: string) => measureCounts(from));
  const runTests = options.runTests ?? vitestRunner;
  const base = readBase(root);
  if (base.kind === "malformed" || base.kind === "unreadable") {
    write(`ratchet: ${base.reason}\n`);
    return 1;
  }
  const testBase = readTestBase(root);
  if (testBase.kind === "malformed" || testBase.kind === "unreadable") {
    write(`ratchet: ${testBase.reason}\n`);
    return 1;
  }
  const scripts = scriptsChange(root);
  if (scripts !== null) {
    write(`ratchet: ${scripts}\n`);
    return 1;
  }
  const measured = measure(root);
  const baseCounts = base.kind === "found" ? base.counts : null;
  const verdict = judge(baseCounts, measured);
  const row = (name: keyof Counts): string =>
    `${name.padEnd(6)}${String(baseCounts?.[name] ?? "-").padStart(5)}  ${String(measured[name]).padStart(8)}`;
  const table = ["type errors   base  measured", row("src"), row("tests")];
  if (verdict.kind === "fail") {
    write(
      `${table.join("\n")}\nratchet: failed, ${verdict.exceeded.join(" and ")} above the base committed at HEAD\n`,
    );
    return 1;
  }
  const baseTests = testBase.kind === "found" ? testBase.record : null;
  const check = checkTests(root, baseTests, runTests);
  const report = [...table, ...testLines(baseTests, check)];
  const testVerdict = check.judgement.verdict;
  if (testVerdict.kind === "fail") {
    const count =
      testVerdict.failed.length + testVerdict.skipped.length + testVerdict.missing.length;
    write(
      `${report.join("\n")}\nratchet: failed, ${count} recorded test${count === 1 ? "" : "s"} failed, skipped or missing against ${PASSING_TESTS_FILE} at HEAD\n`,
    );
    return 1;
  }
  // Serialize both before writing either, so a write never follows a throw.
  const countsText = serializeCounts(measured);
  const testsText = serializeTestRecord(check.judgement.next);
  writeRecord(root, RATCHET_FILE, countsText);
  writeRecord(root, PASSING_TESTS_FILE, testsText);
  const counts =
    verdict.kind === "record"
      ? `the first counts in ${RATCHET_FILE}`
      : `the counts in ${RATCHET_FILE}`;
  const tests =
    testVerdict.kind === "record"
      ? `the first passing tests in ${PASSING_TESTS_FILE}`
      : `the passing tests in ${PASSING_TESTS_FILE}`;
  const outcome =
    verdict.kind === "record" && testVerdict.kind === "record"
      ? `recorded ${counts} and ${tests}`
      : `passed, recorded ${counts} and ${tests}`;
  write(`${report.join("\n")}\nratchet: ${outcome}\n`);
  return 0;
}
