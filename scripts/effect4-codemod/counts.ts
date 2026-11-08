// Type-error counts for the Effect 4 migration: how many errors `tsc` reports for `src`
// and for the test suite. The ratchet compares them from one phase to the next.
//
//   src    errors of `tsc --noEmit -p tsconfig.json --pretty false`
//   tests  errors of `tsc --noEmit -p tsconfig.test.json --pretty false` whose file is
//          not under `src/` (the test project includes `src`, which `src` already counts)
//
// `tsc` runs through an injected runner so tests can supply recorded output.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export type Counts = { readonly src: number; readonly tests: number };

/** Runs a command in `cwd` and returns everything it printed (stdout, then stderr). */
export type Runner = (command: string, args: ReadonlyArray<string>, cwd: string) => string;

/** Key for a diagnostic that names no file (`error TS18003: ...`). */
export const NO_FILE = "(no file)";

/** `path(line,col): error TS1234: message`, at the start of a line. */
const FILE_DIAGNOSTIC = /^(.+?)\(\d+,\d+\): error TS\d+:/;

/** `error TS5058: message`, at the start of a line. */
const GLOBAL_DIAGNOSTIC = /^error TS\d+:/;

/**
 * `tsc --pretty false` errors counted by file. A multi-line diagnostic is one error: its
 * continuation lines are indented and never start a diagnostic.
 */
export function parseTscErrors(output: string): ReadonlyMap<string, number> {
  const byFile = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const file = FILE_DIAGNOSTIC.exec(line)?.[1];
    const key =
      file !== undefined
        ? file.replaceAll("\\", "/")
        : GLOBAL_DIAGNOSTIC.test(line)
          ? NO_FILE
          : undefined;
    if (key !== undefined) byFile.set(key, (byFile.get(key) ?? 0) + 1);
  }
  return byFile;
}

function total(byFile: ReadonlyMap<string, number>, keep: (file: string) => boolean): number {
  let sum = 0;
  for (const [file, count] of byFile) if (keep(file)) sum += count;
  return sum;
}

const isUnderSrc = (file: string): boolean => file === "src" || file.startsWith("src/");

/** `src` is every error of the src project; `tests` is the test project's errors outside `src/`. */
export function countsFrom(srcOutput: string, testsOutput: string): Counts {
  return {
    src: total(parseTscErrors(srcOutput), () => true),
    tests: total(parseTscErrors(testsOutput), (file) => !isUnderSrc(file)),
  };
}

/**
 * The runner phax uses: a real `spawnSync`. tsc exits non-zero when it finds errors, so a
 * non-zero exit is expected; one that printed no diagnostic phax can read (a crash, a
 * panic, a format this parser does not know) throws, rather than read as zero errors and
 * let the ratchet pass.
 */
export const spawnRunner: Runner = (command, args, cwd) => {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === null) throw new Error(`${command} was stopped by ${result.signal}`);
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0 && parseTscErrors(output).size === 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status} with no diagnostic phax can count:\n${output.slice(0, 2000)}`,
    );
  }
  return output;
};

/** The two `tsc` invocations, relative to the root. */
export const SRC_ARGS = ["--noEmit", "-p", "tsconfig.json", "--pretty", "false"] as const;
export const TESTS_ARGS = ["--noEmit", "-p", "tsconfig.test.json", "--pretty", "false"] as const;

export function measureCounts(root: string, run: Runner = spawnRunner): Counts {
  const tsc = join(root, "node_modules/.bin/tsc");
  return countsFrom(run(tsc, SRC_ARGS, root), run(tsc, TESTS_ARGS, root));
}

function tableRow(name: string, was: number, now: number): string {
  return `${name.padEnd(14)}${String(was).padStart(6)}  ${String(now).padStart(5)}`;
}

/** The table a write run prints after the rule table. */
export function typeErrorTable(before: Counts, after: Counts): Array<string> {
  return [
    "type errors   before  after",
    tableRow("src", before.src, after.src),
    tableRow("tests", before.tests, after.tests),
  ];
}
