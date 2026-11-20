// Measures the whole suite per file and per test, and compares two reports.
// Usage: node spikes/test-worlds/measure.mjs run --out <report>
//        node spikes/test-worlds/measure.mjs compare <before> <after> [--allow-new <test file>]...
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const CACHE_PREFIX = "phax-world-cache-";
const SLOW_SECONDS = 30;
const BIG_TEST_FILE = "tests/integration/recordsStatusBranch.test.ts";
const BIG_TEST_NAME =
  "counts only the local-only records of a diverged branch sharing 300 with the remote";
const GUARD_FILE = "tests/integration/phaseGuard.test.ts";
const GUARD_NAME = "lets phax --json-schema print the runner's catalogue";
const CONTRACTS_FILE = "tests/integration/recordsJsonContracts.test.ts";
const CONTRACTS_NAME = "--json-schema prints its entry";
const NOT_RUN = new Set(["skipped", "pending", "todo"]);

const fail = (message, code) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const clean = (text) => String(text).replace(/[\t\r\n]/g, " ");
const toRel = (root, file) => path.relative(root, file).split(path.sep).join("/");
const projectOf = (rel) => (rel.startsWith("tests/unit/") ? "unit" : "integration");
const listCaches = () => readdirSync(os.tmpdir()).filter((n) => n.startsWith(CACHE_PREFIX));
const byKey = (a, b) => {
  const ka = a.slice(0, 3).join("\t");
  const kb = b.slice(0, 3).join("\t");
  if (ka === kb) return 0;
  return ka < kb ? -1 : 1;
};

/** Turn vitest's JSON reporter output into report text. */
const buildReport = (json, root, meta) => {
  const files = [];
  const tests = [];
  for (const file of json.testResults) {
    const rel = toRel(root, file.name);
    const project = projectOf(rel);
    files.push([rel, project, ((file.endTime - file.startTime) / 1000).toFixed(3)]);
    for (const t of file.assertionResults) {
      const name = clean(t.fullName ?? [...t.ancestorTitles, t.title].join(" "));
      tests.push([rel, project, name, t.status, String(Math.round(t.duration ?? 0))]);
    }
  }
  files.sort(byKey);
  tests.sort((a, b) => byKey([a[0], a[1], a[2]], [b[0], b[1], b[2]]));
  const lines = Object.entries(meta).map(([k, v]) => `M\t${k}\t${v}`);
  for (const f of files) lines.push(`F\t${f.join("\t")}`);
  for (const t of tests) lines.push(`T\t${t.join("\t")}`);
  return `${lines.join("\n")}\n`;
};

const parseReport = (file) => {
  const report = { meta: {}, files: new Map(), tests: new Map() };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line === "") continue;
    const p = line.split("\t");
    if (p[0] === "M") report.meta[p[1]] = p[2] ?? "";
    else if (p[0] === "F") {
      report.files.set(`${p[1]}\t${p[2]}`, { file: p[1], project: p[2], seconds: Number(p[3]) });
    } else if (p[0] === "T") {
      // vitest allows two tests of one file to share a full name: number the repeats, in report
      // order, so each is compared with its own counterpart instead of collapsing into one.
      const base = `${p[1]}\t${p[3]}`;
      let key = base;
      for (let n = 2; report.tests.has(key); n += 1) key = `${base}\t#${n}`;
      report.tests.set(key, {
        file: p[1],
        project: p[2],
        name: p[3],
        state: p[4],
        ms: Number(p[5]),
      });
    }
  }
  return report;
};

const run = (args) => {
  const i = args.indexOf("--out");
  if (i < 0 || args[i + 1] === undefined) fail("run: --out <report path> is required", 2);
  const out = path.resolve(args[i + 1]);
  const root = process.cwd();
  const require = createRequire(path.join(root, "package.json"));
  const vitestVersion = JSON.parse(
    readFileSync(require.resolve("vitest/package.json"), "utf8"),
  ).version;
  const vitestBin = path.join(root, "node_modules", ".bin", "vitest");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "phax-measure-"));
  const jsonPath = path.join(tmp, "vitest.json");
  const before = new Set(listCaches());
  const started = Date.now();
  const result = spawnSync(vitestBin, ["run", "--reporter=json", `--outputFile=${jsonPath}`], {
    cwd: root,
    // pnpm puts node_modules/.bin on PATH; tests spawn `tsx` by name and need it too.
    env: {
      ...process.env,
      PATH: `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const wall = (Date.now() - started) / 1000;
  const left = listCaches().filter((n) => !before.has(n));
  let json;
  try {
    json = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`run: vitest wrote no readable JSON report (exit ${result.status}): ${error.message}`, 2);
  }
  rmSync(tmp, { recursive: true, force: true });
  const meta = {
    "wall-seconds": wall.toFixed(1),
    cores: os.availableParallelism(),
    vitest: vitestVersion,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    node: process.version,
    "world-cache-left": left.join(","),
  };
  writeFileSync(out, buildReport(json, root, meta));
  process.stdout.write(`report written to ${out} (vitest exit ${result.status})\n`);
};

const sumBy = (report) => {
  const sums = { integration: 0, unit: 0 };
  for (const f of report.files.values()) sums[f.project] = (sums[f.project] ?? 0) + f.seconds;
  return sums;
};

const baseName = (file) => path.posix.basename(file).replace(/\.test\.ts$/, "");
const fmt = (n) => n.toFixed(1);

const stateOf = (r, file, prefix) => {
  const hits = [...r.tests.values()].filter((t) => t.file === file && t.name.includes(prefix));
  return hits.length === 0 ? "missing" : hits.map((t) => t.state).join(",");
};

const compare = (args) => {
  const positional = [];
  const allowNew = new Set();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-new") allowNew.add(args[++i]);
    else positional.push(args[i]);
  }
  if (positional.length !== 2) fail("compare: <before report> <after report> are required", 2);
  const before = parseReport(positional[0]);
  const after = parseReport(positional[1]);
  const out = [];
  const bs = sumBy(before);
  const as = sumBy(after);
  out.push(`Measures (${after.meta.cores} cores, vitest ${after.meta.vitest}), before -> after:`);
  out.push(
    `  suite wall time: ${before.meta["wall-seconds"]} s -> ${after.meta["wall-seconds"]} s`,
  );
  out.push(
    `  sum of file times: ${fmt(bs.integration + bs.unit)} s -> ${fmt(as.integration + as.unit)} s`,
  );
  out.push(`    integration: ${fmt(bs.integration)} s -> ${fmt(as.integration)} s`);
  out.push(`    unit: ${fmt(bs.unit)} s -> ${fmt(as.unit)} s`);
  out.push("");
  out.push(`Integration files over ${SLOW_SECONDS} s, before -> after:`);
  const slow = [];
  for (const [key, f] of before.files) {
    if (f.project !== "integration") continue;
    const a = after.files.get(key)?.seconds;
    if (f.seconds > SLOW_SECONDS || (a ?? 0) > SLOW_SECONDS) slow.push([f.file, f.seconds, a]);
  }
  for (const [key, f] of after.files) {
    if (f.project === "integration" && !before.files.has(key) && f.seconds > SLOW_SECONDS) {
      slow.push([f.file, 0, f.seconds]);
    }
  }
  slow.sort((x, y) => y[1] - x[1]);
  for (const [file, b, a] of slow) {
    out.push(`  ${baseName(file)}: ${fmt(b)} s -> ${a === undefined ? "missing" : `${fmt(a)} s`}`);
  }
  out.push("");
  const big = (r) =>
    [...r.tests.values()].find((t) => t.file === BIG_TEST_FILE && t.name.endsWith(BIG_TEST_NAME));
  const bb = big(before);
  const ba = big(after);
  out.push(`${BIG_TEST_NAME}:`);
  out.push(
    `  ${bb ? `${bb.ms} ms` : "missing"} -> ${ba ? `${ba.ms} ms` : "missing"}; after under 10 s: ${ba && ba.ms < 10_000 ? "yes" : "no"}`,
  );
  out.push("");
  out.push("q-143 tests, state in the after report:");
  out.push(`  phaseGuard "${GUARD_NAME}": ${stateOf(after, GUARD_FILE, GUARD_NAME)}`);
  out.push(
    `  recordsJsonContracts "${CONTRACTS_NAME}…": ${stateOf(after, CONTRACTS_FILE, CONTRACTS_NAME)}`,
  );
  out.push("");
  const left = after.meta["world-cache-left"] ?? "";
  out.push(`world-cache-left after the run: ${left === "" ? "(none)" : left}`);

  const problems = [];
  for (const [key, b] of before.tests) {
    const a = after.tests.get(key);
    const id = `${b.file} :: ${b.name}`;
    if (a === undefined) problems.push(`missing: ${id}`);
    else if (b.state === "passed" && a.state !== "passed") {
      problems.push(`not passing (${a.state}): ${id}`);
    } else if (!NOT_RUN.has(b.state) && NOT_RUN.has(a.state)) problems.push(`newly skipped: ${id}`);
    else if (a.project !== b.project) {
      problems.push(`project changed (${b.project} -> ${a.project}): ${id}`);
    }
  }
  for (const [key, a] of after.tests) {
    if (!before.tests.has(key) && !allowNew.has(a.file)) {
      problems.push(`unexpected new test: ${a.file} :: ${a.name}`);
    } else if (!before.tests.has(key) && a.state === "failed") {
      problems.push(`new test failing: ${a.file} :: ${a.name}`);
    }
  }
  if (left !== "") problems.push(`cached worlds left behind: ${left}`);
  out.push("");
  out.push(
    problems.length === 0
      ? "test-by-test check: ok"
      : `test-by-test check: ${problems.length} problem(s)`,
  );
  for (const p of problems) out.push(`  ${p}`);
  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(problems.length === 0 ? 0 : 1);
};

const [mode, ...rest] = process.argv.slice(2);
if (mode === "run") run(rest);
else if (mode === "compare") compare(rest);
else
  fail(
    "usage: measure.mjs run --out <report> | compare <before> <after> [--allow-new <file>]...",
    2,
  );
