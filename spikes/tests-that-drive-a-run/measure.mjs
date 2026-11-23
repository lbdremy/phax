// Measures the run-driving tests per file and per test, and compares before and after.
// Run from the repository root: node spikes/tests-that-drive-a-run/measure.mjs <mode> …
// Modes: run, files, gate-step, trace, verdict, table, compare. See README.md beside it.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const ROOT = process.cwd();
const HERE = "spikes/tests-that-drive-a-run";
const TRACE_CONFIG = `${HERE}/vitest.trace.config.mjs`;
const MEASURES = `${HERE}/measures.md`;
const OVER_SECONDS = 10;
const SLOW_SECONDS = 30;
const COVERED_SHARE = 0.5;
const HOOKS = "(hooks)";
const NOT_RUN = new Set(["skipped", "pending", "todo"]);
const RECORDS_REF = "refs/heads/phax/records/v1";

/** The plan's candidate lists: a covered file goes to the first phase listing it, else phase-10. */
const BATCHES = [
  ["phase-03", ["heldStopClose", "heldStopRun"]],
  ["phase-05", ["stopRecords", "acceptancePairReview", "stopSecurityRecord", "recordsExplainStop"]],
  [
    "phase-06",
    [
      "heldStop",
      "heldStopReentry",
      "stopClosedBy",
      "protectedPathsHandoff",
      "noStopUnchanged",
      "declaredCloseInFlight",
    ],
  ],
  ["phase-07", ["declaredStopClose"]],
  ["phase-08", ["heldStopCommands", "stopTranscripts", "stopTurnCosts", "runList"]],
  [
    "phase-09",
    [
      "stoppedRunCommands",
      "enterPhaseStop",
      "closeStopNetwork",
      "declaredStopProviderArgv",
      "structuredAnswerFlags",
      "structuredRetriesExhausted",
    ],
  ],
];

const fail = (message, code) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const clean = (text) => String(text).replace(/[\t\r\n]/g, " ");
const toRel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const projectOf = (rel) => (rel.startsWith("tests/unit/") ? "unit" : "integration");
const baseName = (file) => path.posix.basename(file).replace(/\.test\.ts$/, "");
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : "n/a");
const median = (values) => {
  const v = values.filter((x) => Number.isFinite(x)).toSorted((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const batchOf = (file) => {
  const name = baseName(file);
  for (const [phase, names] of BATCHES) if (names.includes(name)) return phase;
  return "phase-10";
};

const readText = (file) => {
  const bytes = readFileSync(file);
  return file.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
};
const writeText = (file, text) => {
  writeFileSync(file, file.endsWith(".gz") ? gzipSync(text) : text);
};

const binPath = () => path.join(ROOT, "node_modules", ".bin");
const vitestBin = () => path.join(binPath(), "vitest");
const vitestVersion = () => {
  const require = createRequire(path.join(ROOT, "package.json"));
  return JSON.parse(readFileSync(require.resolve("vitest/package.json"), "utf8")).version;
};
const headCommit = () =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

/** The environment of a spawned vitest: node_modules/.bin on PATH, as pnpm puts it. */
const vitestEnv = (extra) => {
  const env = {
    ...process.env,
    PATH: `${binPath()}${path.delimiter}${process.env.PATH ?? ""}`,
    ...extra,
  };
  if (extra.PHAX_TEST_DRIVE_FRESH === undefined) delete env.PHAX_TEST_DRIVE_FRESH;
  return env;
};

/** Run vitest under /usr/bin/time -p; answers the exit status and real, user and sys seconds. */
const timedVitest = (args, env) => {
  const timer = "/usr/bin/time";
  const timed = existsSync(timer);
  const started = Date.now();
  const result = timed
    ? spawnSync(timer, ["-p", vitestBin(), ...args], {
        cwd: ROOT,
        env,
        stdio: ["ignore", "ignore", "pipe"],
        maxBuffer: 1024 * 1024 * 1024,
      })
    : spawnSync(vitestBin(), args, { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
  const elapsed = (Date.now() - started) / 1000;
  const stderr = result.stderr?.toString("utf8") ?? "";
  // The locale may print a decimal comma (`real 0,02`).
  const hits = [...stderr.matchAll(/^(real|user|sys)\s+([0-9]+(?:[.,][0-9]+)?)\s*$/gm)];
  const last = (label) => {
    const hit = hits.findLast((match) => match[1] === label);
    return hit === undefined ? undefined : hit[2].replace(",", ".");
  };
  const real = last("real");
  const user = last("user");
  const sys = last("sys");
  if (real === undefined) {
    process.stderr.write("/usr/bin/time -p wrote no times: wall from the clock, CPU n/a\n");
  }
  return {
    status: result.status,
    stderr,
    wall: real ?? elapsed.toFixed(1),
    user: user ?? "n/a",
    sys: sys ?? "n/a",
  };
};

const readJsonReport = (jsonPath, status) => {
  try {
    return JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (error) {
    return fail(`vitest wrote no readable JSON report (exit ${status}): ${error.message}`, 2);
  }
};

/** `file<TAB>prefix<TAB>driven|restored|fresh` lines, counted per file. */
const prefixLogCounts = (logPath) => {
  if (!existsSync(logPath)) return new Map();
  const counts = new Map();
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const [file, , kind] = line.split("\t");
    const c = counts.get(file) ?? { driven: 0, restored: 0, fresh: 0 };
    if (kind in c) c[kind] += 1;
    counts.set(file, c);
  }
  return counts;
};
const prefixLogMeta = (counts) =>
  [...counts]
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([f, c]) => `${f}:driven=${c.driven},restored=${c.restored},fresh=${c.fresh}`)
    .join(";");

const byKey = (a, b) => {
  const ka = a.slice(0, 3).join("\t");
  const kb = b.slice(0, 3).join("\t");
  if (ka === kb) return 0;
  return ka < kb ? -1 : 1;
};

/** vitest's JSON reporter output as F and T lines, as spikes/test-worlds writes them. */
const buildReport = (json, meta) => {
  const files = [];
  const tests = [];
  for (const file of json.testResults) {
    const rel = toRel(file.name);
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
  for (const line of readText(file).split("\n")) {
    if (line === "") continue;
    const p = line.split("\t");
    if (p[0] === "M") report.meta[p[1]] = p[2] ?? "";
    else if (p[0] === "F") {
      report.files.set(`${p[1]}\t${p[2]}`, { file: p[1], project: p[2], seconds: Number(p[3]) });
    } else if (p[0] === "T") {
      // Two tests of one file may share a full name: number the repeats, in report order.
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

const flagValue = (args, flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  if (args[i + 1] === undefined) fail(`${flag} needs a value`, 2);
  return args[i + 1];
};

// ── run ────────────────────────────────────────────────────────────────────────

const run = (args) => {
  const out = flagValue(args, "--out");
  if (out === undefined) fail("run: --out <report.tsv.gz> is required", 2);
  const project = flagValue(args, "--project");
  const fresh = args.includes("--fresh");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "phax-measure-"));
  const jsonPath = path.join(tmp, "vitest.json");
  const logPath = path.join(tmp, "prefix.log");
  const vitestArgs = ["run", "--reporter=json", `--outputFile=${jsonPath}`];
  if (project !== undefined) vitestArgs.push("--project", project);
  const env = vitestEnv({
    PHAX_TEST_PREFIX_LOG: logPath,
    ...(fresh ? { PHAX_TEST_DRIVE_FRESH: "1" } : {}),
  });
  const timed = timedVitest(vitestArgs, env);
  const json = readJsonReport(jsonPath, timed.status);
  const counts = prefixLogCounts(logPath);
  rmSync(tmp, { recursive: true, force: true });
  const meta = {
    "wall-seconds": timed.wall,
    "user-cpu-seconds": timed.user,
    "system-cpu-seconds": timed.sys,
    cores: os.availableParallelism(),
    vitest: vitestVersion(),
    node: process.version,
    commit: headCommit(),
    "prefix-log": prefixLogMeta(counts),
  };
  writeText(path.resolve(out), buildReport(json, meta));
  process.stdout.write(
    `report written to ${out} (vitest exit ${timed.status}, ${timed.wall} s wall)\n`,
  );
};

// ── files ──────────────────────────────────────────────────────────────────────

const files = (args) => {
  const fresh = args.includes("--fresh");
  const traceOut = flagValue(args, "--trace");
  const list = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trace") i += 1;
    else if (args[i] !== "--fresh") list.push(args[i]);
  }
  if (list.length === 0) fail("files: at least one test file is required", 2);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "phax-measure-"));
  const jsonPath = path.join(tmp, "vitest.json");
  const logPath = path.join(tmp, "prefix.log");
  const env = vitestEnv({
    PHAX_TEST_PREFIX_LOG: logPath,
    ...(fresh ? { PHAX_TEST_DRIVE_FRESH: "1" } : {}),
  });
  const timed = timedVitest(
    ["run", "--project", "integration", "--reporter=json", `--outputFile=${jsonPath}`, ...list],
    env,
  );
  const json = readJsonReport(jsonPath, timed.status);
  const counts = prefixLogCounts(logPath);
  rmSync(tmp, { recursive: true, force: true });
  const out = [`vitest exit ${timed.status}, ${timed.wall} s wall${fresh ? " (fresh)" : ""}`];
  let failed = 0;
  for (const file of json.testResults) {
    const rel = toRel(file.name);
    const c = counts.get(rel);
    const log =
      c === undefined ? "" : ` [driven ${c.driven}, restored ${c.restored}, fresh ${c.fresh}]`;
    out.push(`${rel}: ${((file.endTime - file.startTime) / 1000).toFixed(1)} s${log}`);
    for (const t of file.assertionResults) {
      if (t.status === "failed") failed += 1;
      out.push(`  ${t.status}  ${clean(t.fullName)}  (${Math.round(t.duration ?? 0)} ms)`);
    }
  }
  out.push(`prefix-log: ${prefixLogMeta(counts) || "(none)"}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (traceOut !== undefined) traceFiles(list, traceOut, []);
  process.exit(failed === 0 && timed.status === 0 ? 0 : 1);
};

// ── gate-step ──────────────────────────────────────────────────────────────────

const gateStep = (args) => {
  const out = flagValue(args, "--out");
  if (out === undefined) fail("gate-step: --out <file> is required", 2);
  const started = Date.now();
  const result = spawnSync("pnpm", ["test"], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
  const seconds = (Date.now() - started) / 1000;
  const meta = {
    "gate-step": "pnpm test",
    "gate-step-seconds": seconds.toFixed(1),
    exit: String(result.status),
    cores: os.availableParallelism(),
    vitest: vitestVersion(),
    node: process.version,
    commit: headCommit(),
  };
  writeText(
    path.resolve(out),
    `${Object.entries(meta)
      .map(([k, v]) => `M\t${k}\t${v}`)
      .join("\n")}\n`,
  );
  process.stdout.write(`pnpm test: ${seconds.toFixed(1)} s, exit ${result.status}\n`);
};

// ── trace ──────────────────────────────────────────────────────────────────────

const tmpRoots = (() => {
  const roots = new Set([os.tmpdir()]);
  try {
    roots.add(realpathSync(os.tmpdir()));
  } catch {
    // keep os.tmpdir() alone
  }
  return [...roots].toSorted((a, b) => b.length - a.length);
})();
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TMP_RE = new RegExp(`(?:${tmpRoots.map(escapeRe).join("|")})/[^/\\s"']+`, "g");
const OID_RE = /\b(?:[0-9a-f]{64}|[0-9a-f]{40})\b/g;

/** Temporary roots to <tmp>, the repository to <repo>, 40- and 64-hex ids to <oid>. */
const normalize = (word) =>
  String(word).replace(TMP_RE, "<tmp>").replaceAll(ROOT, "<repo>").replace(OID_RE, "<oid>");

const VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);
/** The first non-option word after `git`, skipping the values of -C, -c and the like. */
const subcommandOf = (argv) => {
  for (let i = 1; i < argv.length; i++) {
    const w = argv[i];
    if (VALUE_OPTIONS.has(w)) i += 1;
    else if (!w.startsWith("-")) return { name: w, at: i };
  }
  return { name: "(none)", at: argv.length };
};
const nextWord = (argv, from) => {
  for (let i = from + 1; i < argv.length; i++) if (!argv[i].startsWith("-")) return argv[i];
  return undefined;
};

/** git processes of one trace2 event file: one per sid with a start event, in start order. */
const readSegmentTrace = (file) => {
  if (!existsSync(file)) return [];
  const bySid = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line === "") continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const p = bySid.get(ev.sid) ?? { sid: ev.sid, argv: undefined, time: "", seconds: 0 };
    if (ev.event === "start") {
      p.argv = ev.argv;
      p.time = ev.time ?? "";
    } else if (ev.event === "exit") p.seconds = Number(ev.t_abs ?? 0);
    bySid.set(ev.sid, p);
  }
  return [...bySid.values()]
    .filter((p) => Array.isArray(p.argv))
    .toSorted((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
};

const newEntry = (name) => ({
  name,
  prefixParams: [],
  late: [],
  git: { prefix: [], own: [], hooks: [] },
  shell: [],
});

/** One file's events and segment traces, as tests in run order plus the hooks entry. */
const foldFileDir = (dir) => {
  const events = readFileSync(path.join(dir, "events.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
  const fileEvent = events.find((e) => e.e === "file");
  const hooks = newEntry(HOOKS);
  const tests = [];
  const owner = new Map();
  let current;
  for (const ev of events) {
    if (ev.e === "test") {
      current = newEntry(ev.test);
      tests.push(current);
    } else if (ev.e === "seg") {
      const entry = ev.kind === "hooks" ? hooks : current;
      owner.set(ev.seg, { entry, kind: ev.kind });
    } else if (ev.e === "helper") {
      const o = owner.get(ev.seg);
      if (o === undefined) continue;
      if (ev.inPrefix) o.entry.prefixParams.push(ev.params);
      else o.entry.late.push(ev.params);
    } else if (ev.e === "child") {
      const o = owner.get(ev.seg);
      if (o !== undefined) o.entry.shell.push({ kind: o.kind, argv: ev.argv });
    }
  }
  for (const [seg, o] of owner) {
    for (const p of readSegmentTrace(path.join(dir, `seg-${seg}.json`)))
      o.entry.git[o.kind].push(p);
  }
  const helperFile = events.some((e) => e.e === "helper");
  return { file: fileEvent?.file ?? "(unknown)", tests, hooks, helperFile };
};

const gitOf = (entry) => [...entry.git.prefix, ...entry.git.own, ...entry.git.hooks];

const countsOf = (procs) => {
  const sub = new Map();
  let records = 0;
  let wtAdd = 0;
  let wtRemove = 0;
  let seconds = 0;
  for (const p of procs) {
    const s = subcommandOf(p.argv);
    sub.set(s.name, (sub.get(s.name) ?? 0) + 1);
    seconds += p.seconds;
    if (s.name === "read-tree" && p.argv.includes("--empty")) records += 1;
    if (s.name === "update-ref" && p.argv.includes(RECORDS_REF)) records += 1;
    if (s.name === "worktree") {
      const w = nextWord(p.argv, s.at);
      if (w === "add") wtAdd += 1;
      if (w === "remove") wtRemove += 1;
    }
  }
  const subcmds = [...sub]
    .toSorted((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return { git: procs.length, seconds, subcmds, records, wtAdd, wtRemove };
};

const oneOffIn = (params) => params.some((p) => p.oneOff !== undefined && p.oneOff !== "");

/** The share of one folded file: repeated prefixes, or repeated heads in a `sequence` file. */
const shareOf = (folded) => {
  const mode = folded.helperFile ? "helper" : "sequence";
  const seen = new Set();
  const earlier = [];
  const rows = [];
  for (const t of folded.tests) {
    const all = gitOf(t);
    let repeats = "-";
    let repeated = 0;
    if (mode === "helper") {
      if (t.prefixParams.length > 0) {
        const key = JSON.stringify(t.prefixParams);
        repeats = !oneOffIn(t.prefixParams) && seen.has(key) ? "yes" : "no";
        if (repeats === "yes") repeated = t.git.prefix.length;
        seen.add(key);
      }
    } else {
      const seq = all.map((p) => JSON.stringify(p.argv.map(normalize)));
      for (const prev of earlier) {
        let n = 0;
        while (n < seq.length && n < prev.length && seq[n] === prev[n]) n += 1;
        repeated = Math.max(repeated, n);
      }
      repeats = repeated > 0 ? "yes" : "no";
      earlier.push(seq);
    }
    rows.push({ test: t, repeats, repeated });
  }
  const total = folded.tests.reduce((n, t) => n + gitOf(t).length, 0) + gitOf(folded.hooks).length;
  const repeatedGit = rows.reduce((n, r) => n + r.repeated, 0);
  return { mode, rows, total, repeatedGit, share: total === 0 ? 0 : repeatedGit / total };
};

const labelOf = (p) => {
  if (p.helper === "createHeldWorld") return "held world";
  if (p.helper === "createWorld") return "stopped-run world";
  if (p.helper === "startHeldRun") {
    const sel = p.hold.split(" ");
    let label =
      sel[0] === "none"
        ? "unheld run"
        : `held ${sel[0] === "listed" ? "at" : sel[0]}${sel[1] ? ` ${sel[1]}` : ""}`;
    if (p.records === "on") label += ", records on";
    if (p.plan !== "Invoice export") label += `, plan "${p.plan}"`;
    if (p.providers !== "default") label += `, providers ${p.providers}`;
    if (p.acceptance !== "none") label += `, acceptance "${p.acceptance}"`;
    return label;
  }
  if (p.helper === "stopRun") {
    let label = `stopped ${p.shortName}`;
    if (p.provider !== "claude-code") label += ` on ${p.provider}`;
    if (p.model !== "claude-sonnet-5-5") label += ` (${p.model})`;
    return label;
  }
  return p.helper;
};
/** The prefix's name: its run-driving calls, worlds left out when a run follows. */
const prefixName = (params) => {
  const runs = params.filter((p) => p.helper === "startHeldRun" || p.helper === "stopRun");
  const named = (runs.length > 0 ? runs : params).map(labelOf).join(" + ");
  return oneOffIn(params) ? `${named} (one-off)` : named;
};
const paramText = (p) =>
  Object.entries(p)
    .filter(([k, v]) => k !== "helper" && v !== "")
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
const paramsText = (params) => params.map((p) => `${p.helper}(${paramText(p)})`).join("; ");

/** Every plain report's integration files, with the median of their times. */
const medianFiles = (reports) => {
  const times = new Map();
  for (const r of reports) {
    for (const f of r.files.values()) {
      if (f.project !== "integration") continue;
      times.set(f.file, [...(times.get(f.file) ?? []), f.seconds]);
    }
  }
  return new Map([...times].map(([f, v]) => [f, median(v)]));
};

/** Split `--from a b c file…` arguments: reports end in .tsv or .tsv.gz. */
const splitFrom = (args) => {
  const reports = [];
  const list = [];
  let out;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--from") continue;
    else if (/\.tsv(\.gz)?$/.test(args[i])) reports.push(args[i]);
    else list.push(args[i]);
  }
  return { reports, list, out };
};

const trace = (args) => {
  const { reports, list, out } = splitFrom(args);
  if (out === undefined) fail("trace: --out <trace.tsv.gz> is required", 2);
  if (reports.length === 0 && list.length === 0)
    fail("trace: --from <report>… or files are required", 2);
  let targets = list;
  if (targets.length === 0) {
    const medians = medianFiles(reports.map(parseReport));
    targets = [...medians]
      .filter(([, s]) => s > OVER_SECONDS)
      .map(([f]) => f)
      .toSorted((a, b) => (a < b ? -1 : 1));
  }
  traceFiles(targets, out, reports);
};

/** Run the trace config over `targets` and write the trace report to `out`. */
function traceFiles(targets, out, reports) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "phax-measure-trace-"));
  const traceDir = path.join(tmp, "segments");
  const jsonPath = path.join(tmp, "vitest.json");
  const env = vitestEnv({
    PHAX_MEASURE_TRACE_DIR: traceDir,
    PHAX_TEST_PREFIX_LOG: path.join(tmp, "prefix.log"),
  });
  delete env.GIT_TRACE2_EVENT;
  const timed = timedVitest(
    ["run", "--config", TRACE_CONFIG, "--reporter=json", `--outputFile=${jsonPath}`, ...targets],
    env,
  );
  const json = readJsonReport(jsonPath, timed.status);
  const states = new Map();
  for (const file of json.testResults) {
    const rel = toRel(file.name);
    for (const t of file.assertionResults) states.set(`${rel}\t${clean(t.fullName)}`, t.status);
  }
  const folded = existsSync(traceDir)
    ? readdirSync(traceDir).map((d) => foldFileDir(path.join(traceDir, d)))
    : [];
  folded.sort((a, b) => (a.file < b.file ? -1 : 1));
  const meta = {
    "trace-wall-seconds": timed.wall,
    cores: os.availableParallelism(),
    vitest: vitestVersion(),
    node: process.version,
    commit: headCommit(),
    from: reports.map((r) => path.posix.basename(r)).join(","),
    files: String(folded.length),
  };
  const lines = Object.entries(meta).map(([k, v]) => `M\t${k}\t${v}`);
  for (const f of folded) {
    const s = shareOf(f);
    const all = [...f.tests.flatMap(gitOf), ...gitOf(f.hooks)];
    const c = countsOf(all);
    const shell = f.tests.reduce((n, t) => n + t.shell.length, 0) + f.hooks.shell.length;
    lines.push(
      [
        "TF",
        f.file,
        s.mode,
        c.git,
        c.seconds.toFixed(2),
        shell,
        c.records,
        c.wtAdd,
        c.wtRemove,
        gitOf(f.hooks).length,
        s.repeatedGit,
        s.share.toFixed(3),
      ].join("\t"),
    );
    const entries = [...s.rows, { test: f.hooks, repeats: "-", repeated: 0 }];
    for (const { test: t, repeats, repeated } of entries) {
      const tc = countsOf(gitOf(t));
      const name = clean(t.name);
      lines.push(
        [
          "TT",
          f.file,
          name,
          t.name === HOOKS ? "-" : (states.get(`${f.file}\t${name}`) ?? "unknown"),
          tc.git,
          Math.round(tc.seconds * 1000),
          tc.subcmds,
          t.shell.length,
          tc.records,
          tc.wtAdd,
          tc.wtRemove,
          t.git.prefix.length,
          JSON.stringify(t.prefixParams),
          repeats,
          repeated,
        ].join("\t"),
      );
      for (const kind of ["prefix", "own", "hooks"]) {
        for (const p of t.git[kind]) {
          lines.push(["G", f.file, name, kind, JSON.stringify(p.argv.map(normalize))].join("\t"));
        }
      }
      for (const sh of t.shell) {
        lines.push(["S", f.file, name, sh.kind, JSON.stringify(sh.argv.map(normalize))].join("\t"));
      }
    }
  }
  writeText(path.resolve(out), `${lines.join("\n")}\n`);
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(
    `trace written to ${out} (${folded.length} files, vitest exit ${timed.status}, ${timed.wall} s wall)\n`,
  );
}

const parseTrace = (file) => {
  const t = { meta: {}, files: new Map() };
  for (const line of readText(file).split("\n")) {
    if (line === "") continue;
    const p = line.split("\t");
    if (p[0] === "M") t.meta[p[1]] = p[2] ?? "";
    else if (p[0] === "TF") {
      t.files.set(p[1], {
        file: p[1],
        mode: p[2],
        git: Number(p[3]),
        gitSeconds: Number(p[4]),
        shell: Number(p[5]),
        records: Number(p[6]),
        wtAdd: Number(p[7]),
        wtRemove: Number(p[8]),
        hooksGit: Number(p[9]),
        repeatedGit: Number(p[10]),
        share: Number(p[11]),
        tests: [],
      });
    } else if (p[0] === "TT") {
      t.files.get(p[1])?.tests.push({
        name: p[2],
        state: p[3],
        git: Number(p[4]),
        gitMs: Number(p[5]),
        subcmds: p[6],
        shell: Number(p[7]),
        records: Number(p[8]),
        wtAdd: Number(p[9]),
        wtRemove: Number(p[10]),
        prefixGit: Number(p[11]),
        prefixParams: JSON.parse(p[12]),
        repeats: p[13],
        repeated: Number(p[14]),
      });
    }
  }
  return t;
};

// ── verdict ────────────────────────────────────────────────────────────────────

/** The covered files: median time over 10 s and share at least one half, most repeated first. */
const coveredOf = (reports, traced) => {
  const medians = medianFiles(reports);
  const rows = [];
  for (const [file, seconds] of medians) {
    if (!(seconds > OVER_SECONDS)) continue;
    const t = traced.files.get(file);
    rows.push({
      file,
      seconds,
      traced: t !== undefined,
      share: t?.share ?? Number.NaN,
      repeatedGit: t?.repeatedGit ?? 0,
      git: t?.git ?? 0,
      mode: t?.mode ?? "untraced",
      covered: t !== undefined && t.share >= COVERED_SHARE,
      batch: batchOf(file),
    });
  }
  rows.sort((a, b) => b.repeatedGit - a.repeatedGit || (a.file < b.file ? -1 : 1));
  return rows;
};

const verdictArgs = (args) => {
  const tracePath = flagValue(args, "--trace");
  const reports = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trace" || args[i] === "--write" || args[i] === "--gate") i += 1;
    else if (args[i] !== "--from") reports.push(args[i]);
  }
  if (tracePath === undefined || reports.length === 0) {
    fail("--from <plain report>… --trace <trace report> are required", 2);
  }
  return { reports: reports.map(parseReport), traced: parseTrace(tracePath) };
};

const verdictLines = (rows) => {
  const covered = rows.filter((r) => r.covered);
  if (covered.length === 0) {
    return [
      "No integration file over 10 s has a repeated-prefix share of at least one half: no file is covered. End the run at this hold.",
    ];
  }
  return covered.map(
    (r, i) =>
      `${i + 1}. \`${r.file}\` → ${r.batch} (share ${(r.share * 100).toFixed(1)} %, ${r.repeatedGit} of ${r.git} git processes repeated, ${fmt(r.seconds)} s${r.mode === "sequence" ? ", sequence" : ""})`,
  );
};

const verdict = (args) => {
  const { reports, traced } = verdictArgs(args);
  const rows = coveredOf(reports, traced);
  const untraced = rows.filter((r) => !r.traced);
  const out = verdictLines(rows);
  for (const r of untraced) out.push(`untraced file over 10 s: ${r.file}`);
  process.stdout.write(`${out.join("\n")}\n`);
  if (untraced.length > 0) process.exit(1);
};

// ── table ──────────────────────────────────────────────────────────────────────

const cell = (text) => String(text).replace(/\|/g, "\\|");
const sumBy = (report) => {
  const sums = { integration: 0, unit: 0 };
  for (const f of report.files.values()) sums[f.project] = (sums[f.project] ?? 0) + f.seconds;
  return sums;
};
const filesAtOnce = (report) => {
  const s = sumBy(report);
  return (s.integration + s.unit) / Number(report.meta["wall-seconds"]);
};

const summaryLines = (reports, gate) => {
  const out = [
    "| run | wall s | sum of file times s | integration s | unit s | user CPU s | system CPU s | files at once |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const rows = reports.map((r) => {
    const s = sumBy(r);
    return [
      Number(r.meta["wall-seconds"]),
      s.integration + s.unit,
      s.integration,
      s.unit,
      Number(r.meta["user-cpu-seconds"]),
      Number(r.meta["system-cpu-seconds"]),
      filesAtOnce(r),
    ];
  });
  rows.forEach((v, i) => out.push(`| ${i + 1} | ${v.map(fmt).join(" | ")} |`));
  const med = rows[0].map((_, k) => median(rows.map((v) => v[k])));
  out.push(`| median | ${med.map(fmt).join(" | ")} |`);
  if (gate !== undefined) {
    out.push("");
    out.push(
      `The gate's \`pnpm test\` step, timed alone by \`gate-step\`: ${gate.meta["gate-step-seconds"]} s wall (exit ${gate.meta.exit}).`,
    );
  }
  return out;
};

const filesLines = (rows, traced) => {
  const out = [
    "| file | median s | git procs | git s | shell cmds | records | worktrees +/- | repeated git | share | covered | mode |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  for (const r of rows.toSorted((a, b) => b.seconds - a.seconds)) {
    const t = traced.files.get(r.file);
    if (t === undefined) {
      out.push(`| \`${baseName(r.file)}\` | ${fmt(r.seconds)} | untraced | | | | | | | | |`);
      continue;
    }
    out.push(
      `| \`${baseName(r.file)}\` | ${fmt(r.seconds)} | ${t.git} | ${fmt(t.gitSeconds)} | ${t.shell} | ${t.records} | +${t.wtAdd} / -${t.wtRemove} | ${t.repeatedGit} | ${(t.share * 100).toFixed(1)} % | ${r.covered ? "yes" : "no"} | ${t.mode === "sequence" ? "sequence" : ""} |`,
    );
  }
  return out;
};

const testsLines = (rows, traced) => {
  const out = [];
  for (const r of rows.toSorted((a, b) => (a.file < b.file ? -1 : 1))) {
    const t = traced.files.get(r.file);
    if (t === undefined) continue;
    out.push(`### \`${r.file}\``);
    out.push("");
    out.push(
      `${t.mode === "sequence" ? "sequence file: the repeated part is the longest head shared with an earlier test" : "helper file: the repeated part is a prefix whose parameters an earlier test drove"}; share ${(t.share * 100).toFixed(1)} %.`,
    );
    out.push("");
    out.push(
      "| # | test | git | git ms | subcommands | shell | records | wt +/- | prefix git | prefix | repeats | repeated |",
    );
    out.push("| ---: | --- | ---: | ---: | --- | ---: | ---: | --- | ---: | --- | --- | ---: |");
    t.tests.forEach((x, i) => {
      const prefix = x.prefixParams.length === 0 ? "" : prefixName(x.prefixParams);
      out.push(
        `| ${x.name === HOOKS ? "" : i + 1} | ${cell(x.name)} | ${x.git} | ${x.gitMs} | ${cell(x.subcmds)} | ${x.shell} | ${x.records} | +${x.wtAdd} / -${x.wtRemove} | ${x.prefixGit} | ${cell(prefix)} | ${x.repeats} | ${x.repeated} |`,
      );
    });
    out.push("");
  }
  return out;
};

const prefixesLines = (rows, traced) => {
  const out = [];
  for (const r of rows) {
    const t = traced.files.get(r.file);
    if (t === undefined || t.mode !== "helper") continue;
    const groups = new Map();
    for (const x of t.tests) {
      if (x.name === HOOKS || x.prefixParams.length === 0) continue;
      const key = JSON.stringify(x.prefixParams);
      const g = groups.get(key) ?? { params: x.prefixParams, tests: 0, git: 0 };
      g.tests += 1;
      g.git += x.prefixGit;
      groups.set(key, g);
    }
    const repeated = [...groups.values()].filter((g) => g.tests > 1 && !oneOffIn(g.params));
    const oneOff = [...groups.values()]
      .filter((g) => oneOffIn(g.params))
      .reduce((n, g) => n + g.tests, 0);
    const single = [...groups.values()]
      .filter((g) => g.tests === 1 && !oneOffIn(g.params))
      .reduce((n, g) => n + g.tests, 0);
    if (repeated.length === 0) continue;
    out.push(
      `- \`${baseName(r.file)}\`${r.covered ? " (covered)" : ""}: ${t.tests.length - 1} tests, ${oneOff} one-off, ${single} with a prefix no other test drives.`,
    );
    for (const g of repeated.toSorted((a, b) => b.tests - a.tests)) {
      out.push(
        `  - "${prefixName(g.params)}": ${paramsText(g.params)}; ${g.tests} tests, ${Math.round(g.git / g.tests)} git processes each.`,
      );
    }
  }
  return out;
};

const replaceSection = (text, name, lines) => {
  const begin = `<!-- BEGIN generated: ${name} -->`;
  const end = `<!-- END generated: ${name} -->`;
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i < 0 || j < i) fail(`table: ${MEASURES} has no ${name} markers`, 2);
  return `${text.slice(0, i + begin.length)}\n\n${lines.join("\n")}\n\n${text.slice(j)}`;
};

const table = (args) => {
  const { reports, traced } = verdictArgs(args);
  const gatePath = flagValue(args, "--gate");
  const gate = gatePath === undefined ? undefined : parseReport(gatePath);
  const rows = coveredOf(reports, traced);
  const sections = {
    summary: summaryLines(reports, gate),
    files: filesLines(rows, traced),
    prefixes: prefixesLines(rows, traced),
    verdict: verdictLines(rows),
    tests: testsLines(rows, traced),
  };
  const target = flagValue(args, "--write");
  if (target === undefined) {
    for (const [name, lines] of Object.entries(sections)) {
      process.stdout.write(`<!-- ${name} -->\n${lines.join("\n")}\n\n`);
    }
    return;
  }
  let text = readFileSync(target, "utf8");
  for (const [name, lines] of Object.entries(sections)) text = replaceSection(text, name, lines);
  writeFileSync(target, text);
  process.stdout.write(`generated sections written to ${target}\n`);
};

// ── compare ────────────────────────────────────────────────────────────────────

/** The covered files measures.md's ## Verdict names. */
const coveredFromMeasures = (file) => {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const at = text.indexOf("## Verdict");
  if (at < 0) return [];
  const rest = text.slice(at + 1);
  const next = rest.indexOf("\n## ");
  const section = next < 0 ? rest : rest.slice(0, next);
  return [...section.matchAll(/^\d+\. `(tests\/integration\/[^`]+\.test\.ts)`/gm)].map((m) => m[1]);
};

const checkPair = (before, after, allowNew, problems) => {
  for (const [key, b] of before.tests) {
    const a = after.tests.get(key);
    const id = `${b.file} :: ${b.name}`;
    if (a === undefined) problems.add(`missing: ${id}`);
    else if (b.state === "passed" && a.state !== "passed") {
      problems.add(`not passing (${a.state}): ${id}`);
    } else if (!NOT_RUN.has(b.state) && NOT_RUN.has(a.state)) problems.add(`newly skipped: ${id}`);
    else if (a.project !== b.project) {
      problems.add(`project changed (${b.project} -> ${a.project}): ${id}`);
    }
  }
  for (const [key, a] of after.tests) {
    if (!before.tests.has(key) && !allowNew.has(a.file)) {
      problems.add(`unexpected new test: ${a.file} :: ${a.name}`);
    } else if (!before.tests.has(key) && a.state === "failed") {
      problems.add(`new test failing: ${a.file} :: ${a.name}`);
    }
  }
};

const m = (reports, f) => median(reports.map(f));
const wall = (r) => Number(r.meta["wall-seconds"]);
const tier = (name) => (r) => sumBy(r)[name];
const all = (r) => sumBy(r).integration + sumBy(r).unit;
const fileTime = (reports, file) =>
  m(reports, (r) => r.files.get(`${file}\tintegration`)?.seconds ?? Number.NaN);

const compare = (args) => {
  const allowNew = new Set();
  const sides = [[], []];
  let side = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-new") allowNew.add(args[++i]);
    else if (args[i] === "--") side = 1;
    else sides[side].push(args[i]);
  }
  if (sides[0].length === 0 || sides[1].length === 0) {
    fail("compare: <before…> -- <after…> are required", 2);
  }
  const before = sides[0].map(parseReport);
  const after = sides[1].map(parseReport);
  const line = (label, f) => `  ${label}: ${fmt(m(before, f))} s -> ${fmt(m(after, f))} s`;
  const out = [
    `Measures (${after[0].meta.cores} cores, vitest ${after[0].meta.vitest}, medians of ${before.length} before and ${after.length} after runs), before -> after:`,
    line("suite wall time", wall),
    line("sum of file times", all),
    line("  integration", tier("integration")),
    line("  unit", tier("unit")),
    line("user CPU", (r) => Number(r.meta["user-cpu-seconds"])),
    line("system CPU", (r) => Number(r.meta["system-cpu-seconds"])),
    `  files at once: ${fmt(m(before, filesAtOnce))} -> ${fmt(m(after, filesAtOnce))}`,
    "",
    `Integration files over ${SLOW_SECONDS} s, before -> after:`,
  ];
  const names = new Set();
  for (const r of [...before, ...after]) {
    for (const f of r.files.values()) if (f.project === "integration") names.add(f.file);
  }
  const slow = [...names]
    .map((f) => [f, fileTime(before, f), fileTime(after, f)])
    .filter(([, b, a]) => b > SLOW_SECONDS || a > SLOW_SECONDS)
    .toSorted((x, y) => (y[1] || 0) - (x[1] || 0));
  for (const [f, b, a] of slow) out.push(`  ${baseName(f)}: ${fmt(b)} s -> ${fmt(a)} s`);
  const covered = coveredFromMeasures(flagValue(args, "--verdict") ?? MEASURES);
  out.push("");
  out.push(`Covered files (${covered.length}), before -> after:`);
  let sb = 0;
  let sa = 0;
  for (const f of covered) {
    const b = fileTime(before, f);
    const a = fileTime(after, f);
    sb += Number.isFinite(b) ? b : 0;
    sa += Number.isFinite(a) ? a : 0;
    out.push(`  ${baseName(f)}: ${fmt(b)} s -> ${fmt(a)} s`);
  }
  out.push(`  sum: ${fmt(sb)} s -> ${fmt(sa)} s; at most half: ${sa <= sb / 2 ? "yes" : "no"}`);
  const problems = new Set();
  for (const b of before) for (const a of after) checkPair(b, a, allowNew, problems);
  out.push("");
  out.push(
    problems.size === 0
      ? "test-by-test check: ok"
      : `test-by-test check: ${problems.size} problem(s)`,
  );
  for (const p of problems) out.push(`  ${p}`);
  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(problems.size === 0 ? 0 : 1);
};

// ── main ───────────────────────────────────────────────────────────────────────

const USAGE = [
  "usage: node spikes/tests-that-drive-a-run/measure.mjs <mode> …",
  "  run --out <report.tsv.gz> [--project integration] [--fresh]",
  "  files [--fresh] [--trace <trace.tsv.gz>] <test file>…",
  "  gate-step --out <file>",
  "  trace --out <trace.tsv.gz> --from <plain report>… [test file…]",
  "  verdict --from <plain report>… --trace <trace report>",
  "  table --from <plain report>… --trace <trace report> [--gate <gate file>] [--write <measures.md>]",
  "  compare <before…> -- <after…> [--allow-new <test file>]… [--verdict <measures.md>]",
].join("\n");

const [mode, ...rest] = process.argv.slice(2);
const MODES = { run, files, "gate-step": gateStep, trace, verdict, table, compare };
if (mode === undefined || !(mode in MODES)) fail(USAGE, 2);
else MODES[mode](rest);
