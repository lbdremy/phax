// phax's lint: runs oxlint once, with its type-aware rules (oxlint-tsgolint) and unused disable directives
// reported, reads every disable directive in the files oxlint lints, and compares both with what the
// operator accepted in lint-baseline.json (scripts/lintBaseline.ts). Exit 0 when nothing goes past the
// baseline, 1 when a diagnostic or a directive goes past it, an entry accepts more than the code has or gives
// no reason, or a directive names no rule; 2 when oxlint gives no report or lints other files than the check
// reads.
//   pnpm lint            the check, as the gate and CI run it
//   pnpm lint --prune    the operator's: lowers or drops the entries above what the code has, adds none
//   pnpm lint --init     the operator's, once: writes today's directives and diagnostics; refuses when the
//                        file exists
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "oxc-parser";

import {
  compare,
  diagnosticsOf,
  directivesOf,
  initialBaseline,
  parseBaseline,
  parseReport,
  passes,
  prune,
  renderBaseline,
  renderFailure,
  type Directive,
  type OxlintReport,
} from "./lintBaseline.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = join(ROOT, "lint-baseline.json");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const FROZEN_LOCK = join(ROOT, "packages", "schemas", "history.lock.json");

/** The extensions oxlint lints. */
const LINTED = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function runOxlint(): OxlintReport {
  const result = spawnSync(
    OXLINT,
    ["--type-aware", "--report-unused-disable-directives-severity=error", "--format", "json", "."],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const report = parseReport(result.stdout);
  if (report !== undefined) return report;
  process.stderr.write(result.stdout + result.stderr);
  return fail(`oxlint gave no report (exit ${String(result.status)})`);
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** oxlint's `ignorePatterns`, gitignore-style, as globs over repository paths. */
function ignoreGlobs(): string[] {
  const config = readJson(join(ROOT, ".oxlintrc.json"));
  const patterns =
    typeof config === "object" && config !== null && "ignorePatterns" in config
      ? config.ignorePatterns
      : [];
  if (!Array.isArray(patterns)) return [];
  return patterns.flatMap((pattern: unknown) => {
    if (typeof pattern !== "string") return [];
    const bare = pattern.replace(/\/+$/, "");
    const anchored = bare.includes("/") ? [bare] : [bare, `**/${bare}`];
    return anchored.flatMap((glob) => [glob, `${glob}/**`]);
  });
}

/** The files oxlint lints: those git tracks or would track, with a linted extension, outside the ignores. */
function lintedFiles(): string[] {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (listed.status !== 0) fail(`git ls-files failed: ${listed.stderr}`);
  const ignores = ignoreGlobs();
  return [...new Set(listed.stdout.split("\0"))].filter(
    (file) =>
      file !== "" &&
      LINTED.has(extname(file)) &&
      existsSync(join(ROOT, file)) &&
      !ignores.some((glob) => matchesGlob(file, glob)),
  );
}

function readDirectives(files: readonly string[]): Directive[] {
  const directives: Directive[] = [];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    if (!source.includes("lint-disable")) continue;
    const { comments } = parseSync(file, source);
    directives.push(...directivesOf(file, source, comments));
  }
  return directives;
}

function frozenModules(): Set<string> {
  const lock = existsSync(FROZEN_LOCK) ? readJson(FROZEN_LOCK) : undefined;
  return new Set(typeof lock === "object" && lock !== null ? Object.keys(lock) : []);
}

const args = new Set(process.argv.slice(2));
const report = runOxlint();
const files = lintedFiles();
if (files.length !== report.number_of_files) {
  fail(
    `oxlint linted ${report.number_of_files} file(s), the check reads the directives of ${files.length}: ` +
      "scripts/lint-baseline.ts must list the files oxlint lints",
  );
}
const directives = readDirectives(files);
const diagnostics = diagnosticsOf(report);

if (args.has("--init")) {
  if (existsSync(BASELINE)) {
    process.stderr.write("lint-baseline.json exists: --init writes only the first baseline\n");
    process.exit(1);
  }
  const first = initialBaseline(directives, diagnostics, frozenModules());
  writeFileSync(BASELINE, renderBaseline(first));
  process.stdout.write(`lint-baseline.json: ${first.entries.length} entry(ies) written\n`);
  process.exit(0);
}

const written = existsSync(BASELINE)
  ? parseBaseline(readFileSync(BASELINE, "utf8"))
  : { entries: [] };
const baseline = args.has("--prune") ? prune(written, directives, diagnostics) : written;
if (args.has("--prune")) {
  writeFileSync(BASELINE, renderBaseline(baseline));
  const dropped = written.entries.length - baseline.entries.length;
  const lowered = baseline.entries.filter((entry) =>
    written.entries.some(
      (before) =>
        before.kind === entry.kind &&
        before.file === entry.file &&
        before.rule === entry.rule &&
        before.count > entry.count,
    ),
  ).length;
  process.stdout.write(
    `lint-baseline.json: ${dropped} entry(ies) dropped, ${lowered} lowered to what the code has\n`,
  );
}

const comparison = compare(directives, diagnostics, baseline);
if (passes(comparison)) {
  process.stdout.write(
    `lint: ${report.number_of_files} file(s), nothing past lint-baseline.json ` +
      `(${directives.length} directive(s), ${diagnostics.length} diagnostic(s) accepted)\n`,
  );
  process.exit(0);
}
process.stderr.write(`${renderFailure(comparison)}\n`);
process.exit(1);
