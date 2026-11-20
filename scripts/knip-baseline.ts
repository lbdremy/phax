// phax's dead-code check: runs knip twice, in its default mode and with `--production --strict`, and
// compares what both find with the findings the operator accepted in knip-baseline.json
// (scripts/knipBaseline.ts). Exit 0 when nothing differs; 1 when a finding is outside the baseline, an
// entry is stale or gives no reason, or knip gives a configuration hint; 2 when knip or the baseline
// cannot be read.
//   pnpm knip            the check, as the gate and CI run it
//   pnpm knip --prune    the operator's: drops the entries nothing matches any more, adds none
//   pnpm knip --init     the operator's, once: writes today's findings as debt; refuses when the file exists
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compare,
  initialBaseline,
  mergeReports,
  parseBaseline,
  passes,
  prune,
  renderBaseline,
  renderFailure,
  type Baseline,
  type KnipReport,
} from "./knipBaseline.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE = join(ROOT, "knip-baseline.json");
const REPORTER = fileURLToPath(new URL("./knip-reporter.ts", import.meta.url));
const KNIP = join(ROOT, "node_modules", ".bin", "knip");

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** One knip run through scripts/knip-reporter.ts. knip exits 1 on findings, which is not an error here. */
function runKnip(extra: readonly string[]): KnipReport {
  const result = spawnSync(KNIP, ["--reporter", REPORTER, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const label = ["knip", ...extra].join(" ");
  if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
    fail(
      `${stdout}${result.stderr ?? ""}${label} failed (exit ${String(result.status)}${result.error ? `, ${result.error.message}` : ""})`,
      2,
    );
  }
  try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as KnipReport;
  } catch {
    return fail(`${stdout}${result.stderr ?? ""}${label} gave no report`, 2);
  }
}

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--init" && arg !== "--prune");
if (unknown.length > 0) fail(`knip-baseline: unknown argument(s) ${unknown.join(" ")}`, 2);
const init = args.includes("--init");
const pruning = args.includes("--prune");
if (init && pruning) fail("knip-baseline: --init and --prune are two commands; give one", 2);
if (init && existsSync(BASELINE)) {
  fail("knip-baseline.json exists: --init writes only the first baseline", 1);
}
if (!init && !existsSync(BASELINE)) {
  fail(
    "knip-baseline.json is missing: the operator writes the first one with `pnpm knip --init`",
    2,
  );
}

const report = mergeReports([runKnip([]), runKnip(["--production", "--strict"])]);

if (init) {
  writeFileSync(BASELINE, renderBaseline(initialBaseline(report)));
  process.stdout.write(
    `knip-baseline.json: ${report.findings.length} finding(s) written as debt\n`,
  );
  process.exit(0);
}

let baseline: Baseline;
try {
  baseline = parseBaseline(readFileSync(BASELINE, "utf8"));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 2);
}

if (pruning) {
  const pruned = prune(baseline, report);
  writeFileSync(BASELINE, renderBaseline(pruned));
  process.stdout.write(
    `knip-baseline.json: ${baseline.entries.length - pruned.entries.length} stale entry(ies) dropped\n`,
  );
  baseline = pruned;
}

const comparison = compare(report, baseline);
if (!passes(comparison)) fail(renderFailure(comparison), 1);
process.stdout.write(
  `knip: no finding outside knip-baseline.json (${baseline.entries.length} accepted)\n`,
);
