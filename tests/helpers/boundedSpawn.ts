// The one way a test starts a child process: `boundedSpawn` (or `boundedOutput`), with a bound
// stated at the call. A test never imports node:child_process itself: the "unbounded test spawns"
// guard in tests/unit/architecturalGuards.test.ts fails any other file under tests/ that does.
//
//   const result = boundedSpawn(CLI_LAUNCHER, cliArgs("ls"), {
//     boundMs: CLI_BOUND_MS,
//     env: phaxHomeEnv(),
//   });
//
// The call is synchronous, like spawnSync, but spawnSync's own timeout reaches only the direct
// child, never a process group. So the child is started by a worker thread of the calling process:
// this same file, loaded by node as the thread's module. The thread starts the command in a process
// group of its own; the calling thread blocks (Atomics.wait) until the thread answers. At the bound
// the thread sends SIGTERM to the group, then SIGKILL once the grace has passed, so the child and
// every descendant end, even one that ignores SIGTERM. Members of the group left after a normal
// exit are ended with SIGKILL too, so none holds the child's pipes open. A thread, not a supervisor
// process: a call costs about what spawnSync costs, where a node process per call cost ~50 ms.
//
// A normal exit is returned with its status, whatever it is, and `leftover`: the members of the
// group still alive after it, which the call ended with SIGKILL. A signal the call names in
// `expectSignal` is returned as a result. Any other ending throws a `BoundedSpawnError` naming
// the command, the bound, the signal, who ended the child and everything it wrote.
//
// A foreign-signal error ends with a `diagnosis:` block: the worker's and the child's pids,
// parents and process groups, the moment, and the related lines of a ps snapshot the thread took
// when it saw the ending. The sender is named when the platform reports it.
//
// PHAX_SPAWN_DIAG_LOG: when it names a file, every ending other than a normal exit (a bound
// included) appends one JSON line to it: the diagnosis fields, the command line, the ending, the
// vitest pool id and the test file. Unset, nothing is written.
//
// The thread loads this file under node's type stripping: it imports only node: modules and uses
// erasable TypeScript only. Keep it that way.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMainThread,
  MessageChannel,
  parentPort,
  receiveMessageOnPort,
  Worker,
  workerData,
} from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

/** The bound of a phax CLI call: about 15 s at most under a loaded gate, with 4× headroom. */
export const CLI_BOUND_MS = 60_000;

/** The bound of a git call. */
export const GIT_BOUND_MS = 20_000;

/** The bound of a call to another tool or script. */
export const SCRIPT_BOUND_MS = 25_000;

/** Time between the SIGTERM at the bound and the SIGKILL that follows it. No call sets it. */
const GRACE_MS = 2_000;
/** What the caller's own wait adds to bound + grace, for a thread that never answers. */
const SAFETY_MARGIN_MS = 5_000;
/** How long the thread waits for the child's pipes to close after it exited. */
const PIPES_CLOSE_MS = 2_000;
/** What a ps listing may hold: a full process table with whole command lines. */
const PS_MAX_BUFFER = 64 * 1024 * 1024;
/** The workerData that tells this file it is the spawning thread, not a test's module. */
const THREAD_TAG = "phax-bounded-spawn-thread";

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), "..", "..");

/** The launcher of every CLI spawn, by absolute path, so no caller relies on PATH. */
export const CLI_LAUNCHER = join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** The arguments of a CLI spawn through `CLI_LAUNCHER`: the CLI's entry, then `args`. */
export function cliArgs(...args: readonly string[]): string[] {
  return [join(REPO_ROOT, "src", "cli", "main.ts"), ...args];
}

// ---------------------------------------------------------------------------------------------
// The protocol between the calling thread and the spawning thread.

type EndingKind = "exit" | "signal" | "bound" | "spawn-error";

interface ThreadCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly env: Record<string, string>;
  readonly input: string | Uint8Array;
  readonly boundMs: number;
  readonly graceMs: number;
}

interface ThreadRequest {
  readonly call: ThreadCall;
  /** [0]: 0 while the call runs, 1 once answered; [1]: the child's pid once started. */
  readonly flag: Int32Array;
  readonly port: MessagePort;
}

interface EndingReport {
  readonly kind: EndingKind;
  /** The child's exit status, or null when a signal ended it or it never started. */
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly elapsedMs: number;
  readonly childPid: number | null;
  readonly pgid: number | null;
  /** When the group was sent SIGTERM at the bound. */
  readonly termAtMs: number | null;
  /** Descendants of the child alive when SIGTERM was sent; null when unknown. */
  readonly descendantsAtTerm: number | null;
  /** When SIGKILL followed, or null when every member had ended within the grace. */
  readonly killAtMs: number | null;
  /** Whether the child itself was still alive when SIGKILL was sent. */
  readonly childKilled: boolean;
  /** Descendants SIGKILL ended: at the grace's end, or left over after a normal exit. */
  readonly descendantsKilled: number | null;
  /** Live members of the group after a normal exit (0 when none); null when ps could not list them. */
  readonly leftover: number | null;
  readonly error: string | null;
  /**
   * `ps -A -o pid,ppid,pgid,stat,lstart,command` at the moment of a non-normal ending or of an
   * exit status above 128; null otherwise.
   */
  readonly snapshot: string | null;
  /** Why ps gave no snapshot, when it failed; null otherwise. */
  readonly snapshotError: string | null;
  /** ISO moment the thread saw the ending. */
  readonly seenAt: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

// ---------------------------------------------------------------------------------------------
// The spawning thread: this file loaded by node as a worker thread's module.

function runCall({ call, flag, port }: ThreadRequest): void {
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);

  let child: ChildProcess | undefined;
  let pgid: number | null = null;
  let childExit: { status: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: string | null = null;
  let boundReached = false;
  let termAtMs: number | null = null;
  let descendantsAtTerm: number | null = null;
  let killAtMs: number | null = null;
  let childKilled = false;
  let descendantsKilled: number | null = null;
  let leftover: number | null = null;
  let ending = false;
  let killed = false;
  let pipesClosed = false;
  let pipesWaitOver = false;
  let reported = false;
  let snapshot: string | null = null;
  let snapshotError: string | null = null;
  let seenAt: string | null = null;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const timers: NodeJS.Timeout[] = [];

  // Taken once, when the thread first sees an ending other than a normal exit.
  const takeSnapshot = (): void => {
    if (snapshot !== null) return;
    seenAt = new Date().toISOString();
    try {
      snapshot = execFileSync("ps", ["-A", "-o", "pid,ppid,pgid,stat,lstart,command"], {
        encoding: "utf8",
        maxBuffer: PS_MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      snapshot = "";
      snapshotError = error instanceof Error ? error.message : String(error);
    }
  };

  // The pids of the group's live members, from ps; null when ps cannot answer. A zombie (stat Z)
  // has ended already: it waits only for its parent, or init, to reap it.
  const members = (): number[] | null => {
    if (pgid === null) return [];
    try {
      const listing = execFileSync("ps", ["-A", "-o", "pid=,pgid=,stat="], {
        encoding: "utf8",
        maxBuffer: PS_MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const pids: number[] = [];
      for (const line of listing.split("\n")) {
        const [pidText, groupText, stat] = line.trim().split(/\s+/);
        const pid = Number(pidText);
        if (Number(groupText) !== pgid || !Number.isInteger(pid) || pid <= 0) continue;
        if (stat?.startsWith("Z")) continue;
        pids.push(pid);
      }
      return pids;
    } catch {
      return null;
    }
  };
  const descendantsOf = (pids: number[] | null): number | null =>
    pids === null ? null : pids.filter((pid) => pid !== child?.pid).length;
  const groupAlive = (): boolean => {
    if (pgid === null) return false;
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "EPERM";
    }
  };
  const signalGroup = (signal: NodeJS.Signals): void => {
    if (pgid === null) return;
    try {
      process.kill(-pgid, signal);
    } catch {
      // the group has ended meanwhile
    }
  };

  const report = (): void => {
    if (reported) return;
    reported = true;
    for (const timer of timers) clearTimeout(timer);
    const kind: EndingKind =
      spawnError !== null
        ? "spawn-error"
        : boundReached
          ? "bound"
          : (childExit?.signal ?? null) !== null
            ? "signal"
            : "exit";
    const ended: EndingReport = {
      kind,
      status: childExit?.status ?? null,
      signal: childExit?.signal ?? null,
      elapsedMs: elapsed(),
      childPid: child?.pid ?? null,
      pgid,
      termAtMs,
      descendantsAtTerm,
      killAtMs,
      childKilled,
      descendantsKilled,
      leftover,
      error: spawnError,
      // Taken only for an ending other than a normal exit, or for a status a launcher may have
      // relayed from a signal (above 128): the caller decides which of those it reports.
      snapshot,
      snapshotError,
      seenAt,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    };
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    port.postMessage(ended);
    port.close();
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  };

  // Reports once the child has exited and its pipes are read, and, after a SIGTERM to the group,
  // once every member has ended or SIGKILL has followed.
  const reportWhenDone = (): void => {
    if (spawnError !== null) {
      report();
      return;
    }
    if (childExit === undefined) return;
    if (ending && !killed && groupAlive()) return;
    if (!pipesClosed && !pipesWaitOver) return;
    report();
  };

  // SIGTERM to the group, then SIGKILL to whatever is left once the grace has passed.
  const endGroup = (): void => {
    if (ending) return;
    ending = true;
    takeSnapshot();
    if (pgid === null) {
      reportWhenDone();
      return;
    }
    termAtMs = elapsed();
    descendantsAtTerm = descendantsOf(members());
    signalGroup("SIGTERM");
    const deadline = performance.now() + call.graceMs;
    const poll = setInterval(() => {
      if (!groupAlive()) {
        clearInterval(poll);
        reportWhenDone();
        return;
      }
      if (performance.now() < deadline) return;
      clearInterval(poll);
      const left = members();
      childKilled = childExit === undefined;
      descendantsKilled = descendantsOf(left);
      killAtMs = elapsed();
      killed = true;
      signalGroup("SIGKILL");
      reportWhenDone();
    }, 20);
  };

  try {
    child = spawn(call.command, [...call.args], {
      ...(call.cwd === null ? {} : { cwd: call.cwd }),
      env: call.env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    spawnError = error instanceof Error ? error.message : String(error);
    takeSnapshot();
    report();
    return;
  }
  if (child.pid !== undefined) {
    pgid = child.pid;
    Atomics.store(flag, 1, child.pid);
  }
  child.on("error", (error) => {
    if (child?.pid !== undefined) return; // a later error of a started child: its exit reports
    spawnError = error.message;
    takeSnapshot();
    reportWhenDone();
  });
  // No cap on what is read, deliberately: spawnSync's maxBuffer (1 MiB) SIGTERMed tsx on the root
  // --json-schema, the stray SIGTERM (tests/integration/strayTermRegression.test.ts).
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  // A child that exits without reading its stdin breaks the pipe: its exit still reports.
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(call.input);
  child.on("close", () => {
    pipesClosed = true;
    reportWhenDone();
  });
  const bound = setTimeout(() => {
    boundReached = true;
    endGroup();
  }, call.boundMs);
  timers.push(bound);
  child.on("exit", (status, signal) => {
    childExit = { status, signal };
    // A status above 128 may be a launcher relaying a signal (tsx exits 143 on SIGTERM): the
    // relayed-signal error needs the same ps snapshot as a signal ending.
    if ((signal !== null || (status ?? 0) > 128) && !ending) takeSnapshot();
    // A process outside the group (one that called setsid) may hold the pipes: stop waiting.
    timers.push(
      setTimeout(() => {
        pipesWaitOver = true;
        reportWhenDone();
      }, PIPES_CLOSE_MS),
    );
    if (ending) {
      reportWhenDone();
      return;
    }
    clearTimeout(bound);
    // A normal exit: a member left in the group would hold the pipes open. It is counted, so a test
    // can tell a child that left a process behind from one that did not.
    leftover = 0;
    if (groupAlive()) {
      leftover = descendantsOf(members());
      descendantsKilled = leftover;
      signalGroup("SIGKILL");
    }
    reportWhenDone();
  });
}

if (!isMainThread && workerData === THREAD_TAG) {
  parentPort?.on("message", (request: ThreadRequest) => runCall(request));
}

// ---------------------------------------------------------------------------------------------
// The calling side.

let thread: Worker | undefined;

// One spawning thread per process, started on the first call; it never keeps the process alive.
function spawningThread(): Worker {
  if (thread !== undefined) return thread;
  const started = new Worker(SELF, { workerData: THREAD_TAG, execArgv: [] });
  started.unref();
  started.on("error", () => {
    if (thread === started) thread = undefined;
  });
  started.on("exit", () => {
    if (thread === started) thread = undefined;
  });
  thread = started;
  return started;
}

interface SpawnOptions {
  /** How long the child may run, in ms: a finite number above 0. Required at every call. */
  readonly boundMs: number;
  readonly cwd?: string;
  /** The child's whole environment; `process.env` when absent. */
  readonly env?: NodeJS.ProcessEnv;
  /** The child's stdin; empty and closed when absent. */
  readonly input?: string | Buffer;
}

/** What a call that ended by a normal exit returns. */
export interface BoundedExit {
  readonly status: number;
  readonly signal: null;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * The child's descendants still alive in its process group after it exited, which the call then
   * ended with SIGKILL: 0 when it left none, null when ps could not list the group.
   */
  readonly leftover: number | null;
}

interface BoundedSignal {
  readonly status: null;
  readonly signal: NodeJS.Signals;
  readonly stdout: string;
  readonly stderr: string;
}

/** A child that ended other than by a normal exit or an expected signal. */
export class BoundedSpawnError extends Error {
  /** The pid of the command the call started, when it started. */
  readonly childPid: number | undefined;

  constructor(message: string, childPid: number | undefined) {
    super(message);
    this.name = "BoundedSpawnError";
    this.childPid = childPid;
  }
}

/**
 * Run `command` with `args` until it ends or its bound passes. Returns a normal exit unchanged;
 * throws a `BoundedSpawnError` for any other ending.
 */
export function boundedSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions & { readonly expectSignal?: undefined },
): BoundedExit;
/** As above, and returns the ending on `expectSignal` as a result instead of throwing. */
export function boundedSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions & { readonly expectSignal: NodeJS.Signals },
): BoundedExit | BoundedSignal;
export function boundedSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions & { readonly expectSignal?: NodeJS.Signals | undefined },
): BoundedExit | BoundedSignal {
  const line = commandLine(command, args);
  const boundMs: unknown = (options as { boundMs?: unknown } | undefined)?.boundMs;
  if (typeof boundMs !== "number" || !Number.isFinite(boundMs) || boundMs <= 0) {
    throw new Error(
      `bounded spawn: \`${line}\` needs a bound: boundMs is required, a finite number of ms above 0 (got ${String(boundMs)})`,
    );
  }

  const call: ThreadCall = {
    command,
    args,
    cwd: options.cwd ?? null,
    env: definedEnv(options.env ?? process.env),
    input: options.input ?? "",
    boundMs,
    graceMs: GRACE_MS,
  };
  const flag = new Int32Array(new SharedArrayBuffer(8));
  const { port1, port2 } = new MessageChannel();
  const safetyMs = boundMs + GRACE_MS + PIPES_CLOSE_MS + SAFETY_MARGIN_MS;
  const request: ThreadRequest = { call, flag, port: port2 };
  spawningThread().postMessage(request, [port2]);
  Atomics.wait(flag, 0, 0, safetyMs);
  const answer = receiveMessageOnPort(port1);
  port1.close();

  if (answer === undefined) {
    const childPid = Atomics.load(flag, 1);
    if (childPid > 0) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        // the group has ended
      }
    }
    const stuck = thread;
    thread = undefined;
    void stuck?.terminate();
    throw new BoundedSpawnError(
      `bounded spawn: \`${line}\` gave no report: its spawning thread did not answer within ` +
        `its safety timeout of ${safetyMs} ms`,
      childPid > 0 ? childPid : undefined,
    );
  }

  // Posted by runCall above, in this same file.
  const report: EndingReport = answer.message;
  const { stdout, stderr } = report;
  const output = streams(stdout, stderr);
  const fail = (lines: string, after = ""): BoundedSpawnError =>
    new BoundedSpawnError(
      `bounded spawn: \`${line}\` ${lines}\n${output}${after}`,
      report.childPid ?? undefined,
    );
  const foreign = (signal: string): string =>
    `ended by ${signal}, not by its bound (${boundMs} ms)`;
  // A foreign-signal ending: logged, and its message ends with the diagnosis block.
  const diagnosed = (lines: string): BoundedSpawnError => {
    const diagnosis = diagnose(report);
    logEnding(line, report, diagnosis);
    return fail(lines, `\n${diagnosisBlock(diagnosis)}`);
  };

  if (report.kind === "spawn-error") {
    logEnding(line, report, diagnose(report));
    const cwd = options.cwd === undefined ? "" : ` (cwd ${options.cwd})`;
    throw fail(`could not start: ${report.error ?? "unknown error"}${cwd}`);
  }
  if (report.kind === "bound") {
    logEnding(line, report, diagnose(report));
    throw fail(`reached its bound (${boundMs} ms) and was ended by it\n  ${groupEnding(report)}`);
  }
  if (report.kind === "signal") {
    const signal = report.signal ?? "SIGKILL";
    if (signal === options.expectSignal) return { status: null, signal, stdout, stderr };
    throw diagnosed(
      `${foreign(signal)}\n  the child received ${signal} from outside the bounded spawn ` +
        `after ${report.elapsedMs} ms`,
    );
  }
  const status = report.status ?? 0;
  const relayed = isLauncherSpawn(command, args) ? relayedSignal(status) : undefined;
  if (relayed !== undefined && relayed === options.expectSignal) {
    return { status: null, signal: relayed, stdout, stderr };
  }
  if (relayed !== undefined) {
    throw diagnosed(
      `${foreign(relayed)}\n  sent through ${displayCommand(command)}: exit status ${status}, ` +
        `after ${report.elapsedMs} ms`,
    );
  }
  return { status, signal: null, stdout, stderr, leftover: report.leftover };
}

/**
 * The bounded counterpart of execFileSync: stdout of a call that exits 0. Any other exit throws
 * a `BoundedSpawnError` naming the command, the status and stderr.
 */
export function boundedOutput(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): string {
  const result = boundedSpawn(command, args, options);
  if (result.status === 0) return result.stdout;
  throw new BoundedSpawnError(
    `bounded spawn: \`${commandLine(command, args)}\` exited with status ${result.status}, not 0\n` +
      streams(result.stdout, result.stderr),
    undefined,
  );
}

interface Row {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly text: string;
}

interface Diagnosis {
  readonly worker: { pid: number; ppid: number; pgid: number | null };
  readonly child: { pid: number | null; pgid: number | null };
  readonly moment: string;
  readonly elapsedMs: number;
  readonly sender: string;
  readonly related: string[];
}

function parseSnapshot(snapshot: string | null): Row[] {
  const rows: Row[] = [];
  for (const text of (snapshot ?? "").split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s/.exec(text);
    if (match !== null) {
      rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), text });
    }
  }
  return rows;
}

function diagnose(report: EndingReport): Diagnosis {
  const rows = parseSnapshot(report.snapshot);
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const worker = byPid.get(process.pid);
  const ancestors = new Set<number>();
  for (let row = worker; row !== undefined && !ancestors.has(row.pid); row = byPid.get(row.ppid)) {
    ancestors.add(row.pid);
  }
  const groups = new Set<number>(
    [worker?.pgid, report.pgid].filter((id): id is number => id !== undefined && id !== null),
  );
  const related =
    report.snapshotError === null
      ? rows
          .filter(
            (row) => ancestors.has(row.pid) || groups.has(row.pgid) || row.pid === report.childPid,
          )
          .map((row) => row.text.trim())
      : [`ps failed: ${report.snapshotError}`];
  return {
    worker: { pid: process.pid, ppid: process.ppid, pgid: worker?.pgid ?? null },
    child: { pid: report.childPid, pgid: report.pgid },
    moment: report.seenAt ?? new Date().toISOString(),
    elapsedMs: report.elapsedMs,
    sender: "not reported by the platform",
    related,
  };
}

function diagnosisBlock(d: Diagnosis): string {
  const id = (n: number | null): string => (n === null ? "unknown" : String(n));
  return [
    "  diagnosis:",
    `    worker: pid ${d.worker.pid}, parent ${d.worker.ppid}, group ${id(d.worker.pgid)}`,
    `    child: pid ${id(d.child.pid)}, group ${id(d.child.pgid)}`,
    `    moment: ${d.moment} (${d.elapsedMs} ms after the start)`,
    `    sender: ${d.sender}`,
    "    ps (pid ppid pgid stat lstart command), the worker, its ancestors, its group and the child's group:",
    ...d.related.map((row) => `      ${row}`),
  ].join("\n");
}

// One JSON line per non-normal ending, when PHAX_SPAWN_DIAG_LOG names a file.
function logEnding(line: string, report: EndingReport, diagnosis: Diagnosis): void {
  const path = process.env["PHAX_SPAWN_DIAG_LOG"];
  if (path === undefined || path === "") return;
  // vitest keeps the running file on its worker state; read it without importing vitest.
  const state: unknown = Reflect.get(globalThis, "__vitest_worker__");
  const file: unknown =
    typeof state === "object" && state !== null ? Reflect.get(state, "filepath") : null;
  try {
    appendFileSync(
      path,
      `${JSON.stringify({
        ending: report.kind,
        signal: report.signal,
        status: report.status,
        command: line,
        ...diagnosis,
        vitestPoolId: process.env["VITEST_POOL_ID"] ?? null,
        testFile: typeof file === "string" ? file : null,
      })}\n`,
    );
  } catch {
    // a log that cannot be written must not hide the ending itself
  }
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined) defined[name] = value;
  return defined;
}

// A launcher that relays its child's signal as status 128 + n: tsx by any path, or the CLI's
// entry run by another launcher.
function isLauncherSpawn(command: string, args: readonly string[]): boolean {
  if (command === CLI_LAUNCHER || basename(command) === "tsx") return true;
  return args.some((arg) => {
    const path = arg.split(sep).join("/");
    return path.endsWith("src/cli/main.ts") || path.endsWith("dist/cli/main.js");
  });
}

// The signal a launcher relayed as status 128 + n. 130 is phax's own interrupted exit.
function relayedSignal(status: number): NodeJS.Signals | undefined {
  if (status <= 128 || status === 130) return undefined;
  const number = status - 128;
  const name = Object.keys(osConstants.signals).find(
    (key) => isSignal(key) && osConstants.signals[key] === number,
  );
  return name !== undefined && isSignal(name) ? name : undefined;
}

function isSignal(name: string): name is NodeJS.Signals {
  return name in osConstants.signals;
}

function groupEnding(report: EndingReport): string {
  const descendants = (n: number | null): string =>
    n === null ? "an unknown number of descendants" : `${n} descendant${n === 1 ? "" : "s"}`;
  const termAt = report.termAtMs ?? 0;
  if (report.killAtMs === null) {
    return (
      `SIGTERM to it and ${descendants(report.descendantsAtTerm)} at ${termAt} ms; ` +
      `all had ended within the ${GRACE_MS} ms grace, no SIGKILL needed`
    );
  }
  const targets = report.childKilled
    ? `it and ${descendants(report.descendantsKilled)}`
    : descendants(report.descendantsKilled);
  return (
    `SIGTERM to it and ${descendants(report.descendantsAtTerm)} at ${termAt} ms, ` +
    `then SIGKILL to ${targets} after ${report.killAtMs - termAt} ms`
  );
}

function streams(stdout: string, stderr: string): string {
  return `${stream("stdout", stdout)}\n${stream("stderr", stderr)}`;
}

function stream(name: string, text: string): string {
  const head = `  ${name} (${Buffer.byteLength(text, "utf8")} bytes):`;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (body === "") return head;
  if (!body.includes("\n")) return `${head} ${body}`;
  return `${head}\n${body
    .split("\n")
    .map((row) => `    ${row}`)
    .join("\n")}`;
}

function displayCommand(command: string): string {
  if (command === CLI_LAUNCHER) return "tsx";
  if (command === process.execPath) return "node";
  return displayArg(command);
}

function displayArg(arg: string): string {
  const rel = isAbsolute(arg) ? relative(REPO_ROOT, arg) : "";
  const shown = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : arg;
  return /^[\w@%+=:,./-]+$/.test(shown) ? shown : JSON.stringify(shown);
}

function commandLine(command: string, args: readonly string[]): string {
  return [displayCommand(command), ...args.map(displayArg)].join(" ");
}
