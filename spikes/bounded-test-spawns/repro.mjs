// Runs the full suite again and again with the bounded spawn's diagnostic log on, and reports every
// child that ended other than by a normal exit.
//
// Usage: node spikes/bounded-test-spawns/repro.mjs [--runs N] [--load gate|none] [--max-workers N]
//                                                  [--parallel K] [--probe N] [--stop-after N]
//                                                  [--out DIR]
//
//   --runs N         rounds to run (default 1). A round runs K suites at once (--parallel).
//   --load gate      before each round, the standard gate profile's every-phase local steps in the
//                    gate's order (format check, typecheck, test:type, lint), so the machine is
//                    in the state a gate leaves it in. `none` (default) skips them.
//   --max-workers N  passed to vitest as --maxWorkers=N (default: vitest's own).
//   --parallel K     suites started at once in each round (default 1).
//   --probe N        alongside each round, up to N calls of `tsx src/cli/main.ts --json-schema`
//                    made as the suites made them before the bounded spawn: a plain spawnSync with
//                    its default maxBuffer. Each call's ending is logged (default 0: no probe).
//   --stop-after N   stop after the round that brings the foreign-signal endings of CLI spawns
//                    to N (default 3).
//   --out DIR        where everything is written (default: a new temporary directory).
//
// Every suite runs node_modules/.bin/vitest with node_modules/.bin first on PATH, as pnpm does,
// PHAX_SPAWN_DIAG_LOG naming a file of its own, and --reporter=json --outputFile=<its own file>.
// Everything a round writes stays under one directory, printed at the start and the end;
// summary.json there holds what the summary prints.
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..", "..");
const BIN = path.join(ROOT, "node_modules", ".bin");
const MAIN = path.join(ROOT, "src", "cli", "main.ts");
// The gate's every-phase local steps before `pnpm test`, read-only, as package.json runs them.
const GATE_STEPS = [
  { name: "format:check", bin: "oxfmt", args: ["--check", "."] },
  { name: "typecheck", bin: "tsc", args: ["--noEmit"] },
  { name: "test:type", bin: "tsc", args: ["--noEmit", "-p", "tsconfig.test.json"] },
  { name: "lint", bin: "tsx", args: ["scripts/lint-baseline.ts"] },
];
const PROBE_PAUSE_MS = 1_000;

const fail = (message) => {
  process.stderr.write(`repro: ${message}\n`);
  process.exit(2);
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The environment every child of this script gets: node_modules/.bin first, no e2e run. */
const baseEnv = () => {
  const env = { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH ?? ""}` };
  delete env.PHAX_E2E_RUN;
  delete env.PHAX_SPAWN_DIAG_LOG;
  return env;
};

const readLines = (file) =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
    : [];

const parseJsonLines = (file) =>
  readLines(file).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [{ unreadable: line }];
    }
  });

// ---------------------------------------------------------------------------------------------
// The probe: this same file started with --probe-child. It makes the pre-bounded-spawn CLI call
// until the round ends or N calls are made.

const probeChild = (count, log, stopFile, home) => {
  const env = { ...baseEnv(), HOME: home };
  for (let i = 0; i < count && !existsSync(stopFile); i += 1) {
    const started = Date.now();
    const at = new Date(started).toISOString();
    const result = spawnSync(path.join(BIN, "tsx"), [MAIN, "--json-schema"], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });
    appendFileSync(
      log,
      `${JSON.stringify({
        i,
        at,
        ms: Date.now() - started,
        status: result.status,
        signal: result.signal,
        error: result.error === undefined ? null : (result.error.code ?? result.error.message),
        stdoutBytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
        stderr: (result.stderr ?? "").slice(0, 400),
      })}\n`,
    );
    sleep(PROBE_PAUSE_MS);
  }
};

// ---------------------------------------------------------------------------------------------
// The driver.

const number = (flag, value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`${flag} needs a whole number, got ${value}`);
  return n;
};

const parseArgs = (argv) => {
  const options = {
    runs: 1,
    load: "none",
    maxWorkers: null,
    parallel: 1,
    probe: 0,
    stopAfter: 3,
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    i += 1;
    if (flag === "--runs") options.runs = number(flag, value);
    else if (flag === "--load") {
      if (value !== "gate" && value !== "none") fail(`--load takes gate or none, got ${value}`);
      options.load = value;
    } else if (flag === "--max-workers") options.maxWorkers = number(flag, value);
    else if (flag === "--parallel") options.parallel = Math.max(1, number(flag, value));
    else if (flag === "--probe") options.probe = number(flag, value);
    else if (flag === "--stop-after") options.stopAfter = number(flag, value);
    else if (flag === "--out" && value !== undefined) options.out = path.resolve(value);
    else fail(`unknown argument ${flag}`);
  }
  return options;
};

const runGateLoad = (dir) => {
  const steps = [];
  for (const { name, bin, args } of GATE_STEPS) {
    const started = Date.now();
    const log = openSync(path.join(dir, `gate-${name}.log`), "w");
    const result = spawnSync(path.join(BIN, bin), args, {
      cwd: ROOT,
      env: baseEnv(),
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    steps.push({ step: name, status: result.status, seconds: (Date.now() - started) / 1000 });
  }
  return steps;
};

/** One suite: resolves with its duration, exit, failures and diagnostic lines. */
const runSuite = (dir, options) =>
  new Promise((resolve) => {
    mkdirSync(dir, { recursive: true });
    const diagLog = path.join(dir, "spawn-diag.jsonl");
    const report = path.join(dir, "vitest.json");
    const output = path.join(dir, "vitest.log");
    const args = ["run", "--reporter=json", `--outputFile=${report}`];
    if (options.maxWorkers !== null) args.push(`--maxWorkers=${options.maxWorkers}`);
    const started = Date.now();
    const out = openSync(output, "w");
    const child = spawn(path.join(BIN, "vitest"), args, {
      cwd: ROOT,
      env: { ...baseEnv(), PHAX_SPAWN_DIAG_LOG: diagLog },
      stdio: ["ignore", out, out],
    });
    child.on("close", (status, signal) => {
      closeSync(out);
      resolve({
        dir,
        seconds: (Date.now() - started) / 1000,
        status,
        signal,
        ...readReport(report),
        workerLosses: workerLosses(output),
        endings: parseJsonLines(diagLog),
      });
    });
  });

const readReport = (file) => {
  if (!existsSync(file)) return { tests: null, failed: [], reportError: "no JSON report written" };
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { tests: null, failed: [], reportError: String(error) };
  }
  const failed = [];
  for (const entry of json.testResults ?? []) {
    const rel = path.relative(ROOT, entry.name);
    for (const test of entry.assertionResults ?? []) {
      if (test.status !== "failed") continue;
      const first = String(test.failureMessages?.[0] ?? "").split("\n")[0];
      failed.push(`${rel} › ${test.fullName ?? test.title}: ${first}`);
    }
    if (entry.status === "failed" && (entry.assertionResults ?? []).length === 0) {
      failed.push(`${rel}: ${String(entry.message ?? "").split("\n")[0]}`);
    }
  }
  return { tests: json.numTotalTests ?? null, failed, reportError: null };
};

// A signal sent to a vitest worker or its process group ends the worker itself: vitest reports it.
const workerLosses = (file) =>
  readLines(file).filter((line) =>
    /exited unexpectedly|Worker exited|terminated unexpectedly/i.test(line),
  );

const isCli = (ending) => /src\/cli\/main\.ts|dist\/cli\/main\.js/.test(String(ending.command));
// The bounded spawn's own tests cause every kind of ending on purpose: a bound, a child that
// SIGTERMs itself, a relayed 143, a command that does not exist.
const OWN_TESTS = "tests/integration/boundedSpawn.test.ts";
const isOwnTest = (ending) => String(ending.testFile ?? "").endsWith(OWN_TESTS);
// Lines are written for signal, relayed-status, bound and spawn-error endings; the first two are
// foreign signals, unless the helper's own tests caused them.
const isForeign = (ending) =>
  !isOwnTest(ending) && (ending.ending === "signal" || ending.ending === "exit");
// An ending as the summary prints it: the ps rows are counted, not printed (summary.json has them).
const brief = ({ related, ...ending }) => ({ ...ending, relatedRows: (related ?? []).length });

const startProbe = (dir, count) => {
  if (count === 0) return null;
  const log = path.join(dir, "probe.jsonl");
  const stopFile = path.join(dir, "probe.stop");
  const home = mkdtempSync(path.join(os.tmpdir(), "phax-repro-home-"));
  const child = spawn(
    process.execPath,
    [SELF, "--probe-child", String(count), log, stopFile, home],
    { cwd: ROOT, env: baseEnv(), stdio: "inherit" },
  );
  const done = new Promise((resolve) => child.on("close", resolve));
  return {
    stop: async () => {
      writeFileSync(stopFile, "");
      await done;
      rmSync(home, { recursive: true, force: true });
      return parseJsonLines(log);
    },
  };
};

const tally = (calls) => {
  const counts = {};
  for (const call of calls) {
    const key = `status ${call.status}, signal ${call.signal}, error ${call.error}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const top = options.out ?? mkdtempSync(path.join(os.tmpdir(), "phax-repro-"));
  mkdirSync(top, { recursive: true });
  process.stdout.write(`repro: ${JSON.stringify(options)}\nrepro: writing under ${top}\n`);
  const rounds = [];
  let foreignCli = 0;
  for (let round = 1; round <= options.runs; round += 1) {
    const dir = path.join(top, `round-${String(round).padStart(2, "0")}`);
    mkdirSync(dir, { recursive: true });
    const startedAt = new Date().toISOString();
    const gate = options.load === "gate" ? runGateLoad(dir) : [];
    const probe = startProbe(dir, options.probe);
    const suites = await Promise.all(
      Array.from({ length: options.parallel }, (_, k) =>
        runSuite(path.join(dir, `suite-${k + 1}`), options),
      ),
    );
    const probeCalls = probe === null ? [] : await probe.stop();
    const foreign = suites.flatMap((suite) => suite.endings.filter(isForeign));
    foreignCli += foreign.filter(isCli).length;
    const entry = {
      round,
      startedAt,
      gate,
      suites,
      probe: {
        calls: probeCalls.length,
        endings: tally(probeCalls),
        notZero: probeCalls.filter((c) => c.status !== 0),
      },
    };
    rounds.push(entry);
    writeFileSync(
      path.join(top, "summary.json"),
      `${JSON.stringify({ options, rounds }, null, 2)}\n`,
    );
    for (const suite of suites) {
      process.stdout.write(
        `round ${round} ${path.basename(suite.dir)}: ${suite.seconds.toFixed(1)} s, vitest exit ` +
          `${suite.status}${suite.signal === null ? "" : ` (${suite.signal})`}, ${suite.tests ?? "?"} tests, ` +
          `${suite.failed.length} failed, ${suite.endings.length} logged endings ` +
          `(${suite.endings.filter(isOwnTest).length} from ${OWN_TESTS}, ` +
          `${suite.endings.filter(isForeign).length} foreign), ` +
          `${suite.workerLosses.length} worker losses\n`,
      );
    }
    if (probe !== null) {
      process.stdout.write(`round ${round} probe: ${JSON.stringify(entry.probe.endings)}\n`);
    }
    if (foreignCli >= options.stopAfter) {
      process.stdout.write(`repro: ${foreignCli} foreign-signal endings of CLI spawns: stopping\n`);
      break;
    }
  }
  printSummary(top, rounds);
};

const printSummary = (top, rounds) => {
  const suites = rounds.flatMap((round) => round.suites);
  const lines = [
    "",
    "Summary",
    `  rounds: ${rounds.length}, suites: ${suites.length}`,
    `  suite seconds: ${suites.map((s) => s.seconds.toFixed(0)).join(", ")}`,
    `  suites failing: ${suites.filter((s) => s.status !== 0).length}`,
  ];
  for (const suite of suites) {
    for (const failure of suite.failed)
      lines.push(`  failed: ${path.relative(top, suite.dir)}: ${failure}`);
    for (const loss of suite.workerLosses)
      lines.push(`  worker: ${path.relative(top, suite.dir)}: ${loss}`);
  }
  const endings = suites.flatMap((s) =>
    s.endings.map((e) => ({ suite: path.relative(top, s.dir), ...e })),
  );
  const own = endings.filter(isOwnTest);
  lines.push(
    `  non-normal endings logged: ${endings.length} (${own.length} from ${OWN_TESTS}, ` +
      `${endings.filter(isForeign).length} foreign)`,
  );
  for (const ending of endings.filter((e) => !isOwnTest(e))) {
    lines.push(`  ending: ${JSON.stringify(brief(ending))}`);
  }
  const ownKinds = {};
  for (const ending of own) ownKinds[ending.ending] = (ownKinds[ending.ending] ?? 0) + 1;
  if (own.length > 0) lines.push(`  from ${OWN_TESTS}: ${JSON.stringify(ownKinds)}`);
  const probe = rounds.flatMap((round) =>
    round.probe.notZero.map((c) => ({ round: round.round, ...c })),
  );
  const probeCalls = rounds.reduce((n, round) => n + round.probe.calls, 0);
  if (probeCalls > 0) {
    const all = {};
    for (const round of rounds) {
      for (const [key, n] of Object.entries(round.probe.endings)) all[key] = (all[key] ?? 0) + n;
    }
    lines.push(`  probe calls: ${probeCalls}: ${JSON.stringify(all)}`);
    for (const call of probe) lines.push(`  probe not 0: ${JSON.stringify(call)}`);
  }
  lines.push(`  everything under ${top}`);
  process.stdout.write(`${lines.join("\n")}\n`);
};

if (process.argv[2] === "--probe-child") {
  const [count, log, stopFile, home] = process.argv.slice(3);
  probeChild(Number(count), log, stopFile, home);
} else {
  await main();
}
