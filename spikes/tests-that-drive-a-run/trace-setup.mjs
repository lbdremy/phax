// A setup module for spikes/tests-that-drive-a-run/vitest.trace.config.mjs. Inert unless
// PHAX_MEASURE_TRACE_DIR names a directory. It never changes what a test does; it only watches:
//
// (1) Segments. Every test gets a segment list keyed by its file and full name. A test starts in
//     its `prefix` segment, which stays open through the calls of the run-driving helpers and ends
//     at the first git process or shell command the test issues outside such a call; the rest of
//     the test is its `own` segment. Work outside any test (collection, beforeAll, afterAll) goes
//     to the file's `hooks` segment. GIT_TRACE2_EVENT points at the current segment's trace file,
//     so git's own trace (one JSON event per line) lands in the right segment.
// (2) Helpers. `createHeldWorld`, `startHeldRun`, `createWorld` and `stopRun` are wrapped in plain
//     functions (not vi.fn, so vi.clearAllMocks and vi.restoreAllMocks cannot touch them) through
//     vi.mock of the two fixture modules, and each call's parameters are logged.
// (3) Children. node:child_process is patched in place (createRequire + syncBuiltinESMExports), and
//     `boundedSpawn` / `boundedOutput` are wrapped the same way as the helpers, because they start
//     the child from a worker thread the patch cannot reach. Every child that is not git is logged
//     with its argv and cwd; every child, git or not, gets GIT_TRACE2_EVENT set to the current
//     segment in an explicit `env`, so a test that builds its own environment is traced too.
//
// Events go to <dir>/<file digest>/events.jsonl, git's traces to <dir>/<file digest>/seg-<n>.json.
// measure.mjs folds them into the trace report.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";

const KEY = Symbol.for("phax.measure.trace");
const DIR = process.env.PHAX_MEASURE_TRACE_DIR;
const ROOT = process.cwd();

vi.mock("../../tests/helpers/heldRunFixture.ts", async (importOriginal) => {
  const mod = await importOriginal();
  const tracer = globalThis[Symbol.for("phax.measure.trace")];
  if (tracer === undefined) return mod;
  return {
    ...mod,
    createHeldWorld: (...args) =>
      tracer.helper("createHeldWorld", args, mod, () => mod.createHeldWorld(...args)),
    startHeldRun: (...args) =>
      tracer.helper("startHeldRun", args, mod, () => mod.startHeldRun(...args)),
  };
});

vi.mock("../../tests/helpers/stoppedRunFixture.ts", async (importOriginal) => {
  const mod = await importOriginal();
  const tracer = globalThis[Symbol.for("phax.measure.trace")];
  if (tracer === undefined) return mod;
  return {
    ...mod,
    createWorld: (...args) =>
      tracer.helper("createWorld", args, mod, () => mod.createWorld(...args)),
    stopRun: (...args) => tracer.helper("stopRun", args, mod, () => mod.stopRun(...args)),
  };
});

vi.mock("../../tests/helpers/boundedSpawn.ts", async (importOriginal) => {
  const mod = await importOriginal();
  const tracer = globalThis[Symbol.for("phax.measure.trace")];
  if (tracer === undefined) return mod;
  return {
    ...mod,
    boundedSpawn: (command, args, options) =>
      mod.boundedSpawn(command, args, tracer.bounded(command, args, options)),
    boundedOutput: (command, args, options) =>
      mod.boundedOutput(command, args, tracer.bounded(command, args, options)),
  };
});

const sha = (text) => createHash("sha256").update(text).digest("hex");
const relOf = (file) => path.relative(ROOT, file).split(path.sep).join("/");

/** The full name as vitest's JSON reporter writes it. */
const fullNameOf = (task) => {
  const titles = [];
  for (let s = task.suite; s; s = s.suite) titles.push(s.name);
  titles.reverse();
  return task.name ? [...titles, task.name].join(" ") : titles.join(" ");
};

const holdLabel = (hold) => {
  if (hold === undefined || hold === null) return "none";
  if (typeof hold !== "object") return String(hold);
  const phases = Array.isArray(hold.phases) ? ` ${hold.phases.join(",")}` : "";
  return `${hold.selection}${phases}`;
};

/** The parameters of one helper call: what the prefix it drives depends on. */
const paramsOf = (name, args, mod) => {
  if (name === "startHeldRun") {
    const opts = args[2] ?? {};
    const plan = opts.plan ?? mod.invoiceExportPlan();
    return {
      helper: name,
      hold: holdLabel(args[1]),
      records: opts.records === true ? "on" : "off",
      plan: plan.plan.run.title,
      planMd: sha(plan.planMd).slice(0, 12),
      providers:
        opts.providerConfig === undefined
          ? "default"
          : sha(JSON.stringify(opts.providerConfig)).slice(0, 12),
      acceptance: opts.acceptance?.command ?? "none",
      oneOff: typeof opts.prepare === "function" ? "prepare" : "",
    };
  }
  if (name === "stopRun") {
    const opts = args[1] ?? {};
    return {
      helper: name,
      shortName: opts.shortName ?? "invoice-export",
      provider: opts.provider ?? "claude-code",
      model: opts.model ?? "claude-sonnet-5-5",
      oneOff: "sessionId" in opts && opts.sessionId === undefined ? "sessionId-undefined" : "",
    };
  }
  return { helper: name };
};

const argvOf = (command, args) => [
  String(command),
  ...(Array.isArray(args) ? args.map(String) : []),
];
const isGit = (command) => path.basename(String(command)) === "git";

function makeTracer(dir) {
  const state = {
    file: undefined,
    base: undefined,
    seg: -1,
    segPath: undefined,
    /** The current test, or undefined in hooks. */
    test: undefined,
    prefixOpen: false,
    depth: 0,
  };
  const event = (record) => {
    if (state.base === undefined) return;
    appendFileSync(path.join(state.base, "events.jsonl"), `${JSON.stringify(record)}\n`);
  };
  const open = (kind) => {
    state.seg += 1;
    state.segPath = path.join(state.base, `seg-${state.seg}.json`);
    process.env.GIT_TRACE2_EVENT = state.segPath;
    event({ e: "seg", seg: state.seg, kind, test: state.test ?? null });
  };
  const ensureFile = () => {
    if (state.base !== undefined) return;
    const testPath = expect.getState().testPath;
    if (typeof testPath !== "string") return;
    state.file = relOf(testPath);
    state.base = path.join(dir, sha(state.file).slice(0, 16));
    mkdirSync(state.base, { recursive: true });
    event({ e: "file", file: state.file });
    open("hooks");
  };
  /** A child is about to start outside a helper: it ends the open prefix. */
  const beforeChild = (argv, cwd) => {
    ensureFile();
    if (state.depth === 0 && state.test !== undefined && state.prefixOpen) {
      state.prefixOpen = false;
      open("own");
    }
    if (!isGit(argv[0])) event({ e: "child", seg: state.seg, argv, cwd: cwd ?? null });
  };
  const withTraceEnv = (options) => {
    if (options === undefined || options === null || typeof options !== "object") return options;
    if (options.env === undefined || state.segPath === undefined) return options;
    return { ...options, env: { ...options.env, GIT_TRACE2_EVENT: state.segPath } };
  };
  return {
    state,
    ensureFile,
    startTest(name) {
      ensureFile();
      state.test = name;
      state.prefixOpen = true;
      state.depth = 0;
      event({ e: "test", test: name });
      open("prefix");
    },
    endTest() {
      state.test = undefined;
      state.prefixOpen = false;
      state.depth = 0;
      open("hooks");
    },
    helper(name, args, mod, call) {
      ensureFile();
      event({
        e: "helper",
        seg: state.seg,
        inPrefix: state.test !== undefined && state.prefixOpen,
        params: paramsOf(name, args, mod),
      });
      state.depth += 1;
      let result;
      try {
        result = call();
      } catch (error) {
        state.depth -= 1;
        throw error;
      }
      if (result !== null && typeof result === "object" && typeof result.then === "function") {
        return result.finally(() => {
          state.depth -= 1;
        });
      }
      state.depth -= 1;
      return result;
    },
    bounded(command, args, options) {
      beforeChild(argvOf(command, args), options?.cwd);
      return withTraceEnv(options);
    },
    beforeChild,
    withTraceEnv,
  };
}

/** Patch node:child_process in place so every child is seen before it starts. */
function patchChildProcess(tracer) {
  const require = createRequire(import.meta.url);
  const cp = require("node:child_process");
  if (cp[KEY] === true) return;
  cp[KEY] = true;
  const current = () => globalThis[KEY] ?? tracer;
  // spawn(file, args?, options?), spawnSync, execFile(file, args?, options?, cb?), execFileSync.
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
    const original = cp[name];
    cp[name] = function patched(file, ...rest) {
      const t = current();
      const args = Array.isArray(rest[0]) ? rest[0] : [];
      const at = Array.isArray(rest[0]) ? 1 : 0;
      const options = rest[at] !== null && typeof rest[at] === "object" ? rest[at] : undefined;
      t.beforeChild(argvOf(file, args), options?.cwd);
      if (options !== undefined) rest[at] = t.withTraceEnv(options);
      return original.call(this, file, ...rest);
    };
  }
  // exec(command, options?, cb?), execSync(command, options?): a shell line.
  for (const name of ["exec", "execSync"]) {
    const original = cp[name];
    cp[name] = function patched(command, ...rest) {
      const t = current();
      const options = rest[0] !== null && typeof rest[0] === "object" ? rest[0] : undefined;
      const word = String(command).trim().split(/\s+/)[0] ?? "";
      t.beforeChild(
        isGit(word) ? ["git", String(command)] : ["sh", "-c", String(command)],
        options?.cwd,
      );
      if (options !== undefined) rest[0] = t.withTraceEnv(options);
      return original.call(this, command, ...rest);
    };
  }
  syncBuiltinESMExports();
}

if (DIR !== undefined && DIR !== "") {
  const tracer = makeTracer(DIR);
  globalThis[KEY] = tracer;
  patchChildProcess(tracer);
  tracer.ensureFile();
  beforeAll(() => {
    tracer.ensureFile();
  });
  beforeEach((ctx) => {
    tracer.startTest(fullNameOf(ctx.task));
  });
  afterEach(() => {
    tracer.endTest();
  });
  afterAll(() => {
    delete process.env.GIT_TRACE2_EVENT;
  });
}
