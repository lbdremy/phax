// `pnpm codemod:effect4`: runs phax's Effect 4 codemod over a tree's TypeScript.
//
//   pnpm codemod:effect4 [--root <dir>] [--check | --ratchet]
//
// Targets `src/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.ts`, `site/**/*.ts` and
// `packages/schemas/**/*.ts` under the root (the current directory by default), leaving
// out `dist` and `node_modules` directories, `tests/e2e/fixtures/**`, the codemod's own
// fixtures and the codemod itself.
//
// By default it writes the changed files, prints a per-rule table and lists every v3
// symbol it left, under the topic skill that owns it. `--check` writes nothing, prints
// how many files would change and the same list, and exits 1 when any file would change.
// A write run also measures the type errors of `src` and of the test suite before and
// after, and prints them (a root without a tsconfig.json is not measured). `--ratchet`
// rewrites nothing: it compares the measured counts with those committed at HEAD, also
// runs the unit and integration suites and holds the passing tests to the record
// committed at HEAD, and records both (see ratchet.ts and passingTests.ts). The codemod
// reads nothing over the network.
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rewriteFiles, type CodemodResult } from "./codemod.js";
import { measureCounts, typeErrorTable, type Counts } from "./counts.js";
import { vitestRunner, type TestRunner } from "./passingTests.js";
import { loadReference, REFERENCE_NAME } from "./reference.js";
import { runRatchet } from "./ratchet.js";
import { RULES } from "./rules.js";

const TARGET_DIRECTORIES = ["src", "tests", "scripts", "site", "packages/schemas"];

/** Path prefixes (repository-relative, POSIX) the codemod never touches. */
const EXCLUDED_PREFIXES = [
  "tests/e2e/fixtures/",
  "tests/unit/effect4Codemod/__fixtures__/",
  "scripts/effect4-codemod/",
];

/** Directory names left out wherever they appear. */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set(["dist", "node_modules"]);

type Options = { readonly root: string; readonly check: boolean; readonly ratchet: boolean };

function parseArguments(argv: ReadonlyArray<string>): Options | string {
  let root = process.cwd();
  let check = false;
  let ratchet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
    } else if (argument === "--ratchet") {
      ratchet = true;
    } else if (argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return "--root needs a directory";
      root = resolve(value);
      index += 1;
    } else {
      return `unknown argument: ${argument ?? ""}`;
    }
  }
  if (check && ratchet) return "--check and --ratchet cannot be combined";
  return { root, check, ratchet };
}

/** Every target file under `root`, as sorted repository-relative POSIX paths. */
function targetFiles(root: string): Array<string> {
  const files: Array<string> = [];
  const walk = (relative: string): void => {
    const directory = join(root, relative);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) return;
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries.toSorted((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = `${relative}/${entry.name}`;
      if (EXCLUDED_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix))) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(path);
      }
    }
  };
  for (const directory of TARGET_DIRECTORIES) walk(directory);
  return files;
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

/** The per-rule table: rule, files it changed, rewrites, and the lines it cites. */
function ruleTable(result: CodemodResult): Array<string> {
  const lines = [`${pad("rule", 22)}${pad("files", 7)}${pad("rewrites", 10)}reference`];
  for (const rule of RULES) {
    const counts = result.files.map((file) => file.rewrites[rule.id] ?? 0);
    const files = counts.filter((count) => count > 0).length;
    const rewrites = counts.reduce((sum, count) => sum + count, 0);
    const cited = rule.mappings.map((mapping) => mapping.line).join(",");
    lines.push(
      `${pad(rule.id, 22)}${pad(String(files), 7)}${pad(String(rewrites), 10)}${REFERENCE_NAME}:${cited}`,
    );
  }
  return lines;
}

/** `left to phases (<n>):` and one line per leftover. */
function leftoverLines(result: CodemodResult): Array<string> {
  const reference = loadReference();
  const lines = [`left to phases (${result.leftovers.length}):`];
  for (const leftover of result.leftovers) {
    const entry = reference.entryOf(leftover.v3Symbol);
    const target =
      entry === undefined ? "(no entry)" : (entry.targets?.join(", ") ?? "(no stated target)");
    const cited = `${REFERENCE_NAME}:${leftover.referenceLine ?? "-"}`;
    const blocked =
      leftover.blockedBy === null
        ? ""
        : `  (blocked by ${leftover.blockedBy.v3Symbol} at line ${leftover.blockedBy.line}: migrate it, then re-run)`;
    lines.push(
      `${leftover.owner}  ${leftover.path}:${leftover.line}  ${leftover.v3Symbol} -> ${target}  ${cited}${blocked}`,
    );
  }
  return lines;
}

/**
 * The type-error counts of `root`, or null when it has no tsconfig.json to measure (a
 * scratch tree). A root with a tsconfig but no installed tsc fails loudly.
 */
function measureOrSkip(root: string, measure: (root: string) => Counts): Counts | null {
  return existsSync(join(root, "tsconfig.json")) ? measure(root) : null;
}

/** What `run` reaches outside the tree it rewrites; tests pass their own. */
export type RunDependencies = {
  readonly measure: (root: string) => Counts;
  readonly runTests: TestRunner;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
};

const processDependencies: RunDependencies = {
  measure: (root) => measureCounts(root),
  runTests: vitestRunner,
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

/** Runs the codemod with `argv` (the arguments after the script) and returns its exit code. */
export function run(
  argv: ReadonlyArray<string>,
  dependencies: RunDependencies = processDependencies,
): number {
  const options = parseArguments(argv);
  if (typeof options === "string") {
    dependencies.stderr(
      `codemod:effect4: ${options}\nusage: codemod:effect4 [--root <dir>] [--check | --ratchet]\n`,
    );
    return 2;
  }
  if (options.ratchet) {
    return runRatchet(options.root, {
      measure: dependencies.measure,
      runTests: dependencies.runTests,
      write: dependencies.stdout,
    });
  }
  const before = options.check ? null : measureOrSkip(options.root, dependencies.measure);
  const result = rewriteFiles({ root: options.root, files: targetFiles(options.root) });
  const changed = result.files.filter((file) => file.after !== file.before);
  const out: Array<string> = [];
  if (options.check) {
    out.push(`${changed.length} files would change`);
    for (const file of changed) out.push(`  ${file.path}`);
  } else {
    for (const file of changed) writeFileSync(join(options.root, file.path), file.after);
    out.push(...ruleTable(result), `${changed.length} files changed`);
    const after = before === null ? null : measureOrSkip(options.root, dependencies.measure);
    out.push(
      ...(before === null || after === null
        ? ["type errors   not measured (no tsconfig.json under the root)"]
        : typeErrorTable(before, after)),
    );
  }
  out.push(...leftoverLines(result));
  dependencies.stdout(`${out.join("\n")}\n`);
  return options.check && changed.length > 0 ? 1 : 0;
}

// Run only as the script itself, so a test can import `run`.
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  process.exitCode = run(process.argv.slice(2));
}
