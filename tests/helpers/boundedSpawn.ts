// The one way a test starts a child process: `boundedSpawn` (or `boundedOutput`), with a bound
// stated at the call. A test never imports node:child_process itself.
//
//   const result = boundedSpawn(CLI_LAUNCHER, cliArgs("ls"), {
//     boundMs: CLI_BOUND_MS,
//     env: phaxHomeEnv(),
//   });
//
// The call is synchronous, like spawnSync, but a synchronous call cannot end a process group, so
// it runs a supervisor: this same file, run by node as its own main module. The supervisor starts
// the command in a process group of its own and writes how it ended to a report file. At the
// bound it sends SIGTERM to the group, then SIGKILL once the grace has passed, so the child and
// every descendant end, even one that ignores SIGTERM. Members of the group left after a normal
// exit are ended with SIGKILL too, so none holds the caller's pipes open.
//
// A normal exit is returned unchanged, whatever its status. A signal the call names in
// `expectSignal` is returned as a result. Any other ending throws a `BoundedSpawnError` naming
// the command, the bound, the signal, who ended the child and everything it wrote.
//
// The supervisor runs this file under node's type stripping: it imports only node: modules and
// uses erasable TypeScript only. Keep it that way.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The bound of a phax CLI call: about 15 s at most under a loaded gate, with 4× headroom. */
export const CLI_BOUND_MS = 60_000;

/** Time between the SIGTERM at the bound and the SIGKILL that follows it. No call sets it. */
const GRACE_MS = 2_000;
/** What the caller's own timeout adds to bound + grace, for a supervisor that never reports. */
const SAFETY_MARGIN_MS = 5_000;
const MAX_BUFFER = 512 * 1024 * 1024;

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SELF), "..", "..");

/** The launcher of every CLI spawn, by absolute path, so no caller relies on PATH. */
export const CLI_LAUNCHER = join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** The arguments of a CLI spawn through `CLI_LAUNCHER`: the CLI's entry, then `args`. */
export function cliArgs(...args: readonly string[]): string[] {
  return [join(REPO_ROOT, "src", "cli", "main.ts"), ...args];
}

// ---------------------------------------------------------------------------------------------
// The protocol between the caller and the supervisor.

type EndingKind = "exit" | "signal" | "bound" | "supervisor-signal" | "spawn-error";

interface SupervisorCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly env: Record<string, string>;
  readonly boundMs: number;
  readonly graceMs: number;
  readonly reportPath: string;
  readonly startedPath: string;
}

interface SupervisorReport {
  readonly kind: EndingKind;
  /** The child's exit status, or null when a signal ended it or it never started. */
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly elapsedMs: number;
  readonly supervisorPid: number;
  readonly childPid: number | null;
  readonly pgid: number | null;
  /** The signal the supervisor itself received, for kind supervisor-signal. */
  readonly supervisorSignal: NodeJS.Signals | null;
  /** When the group was sent SIGTERM (at the bound or on a supervisor signal). */
  readonly termAtMs: number | null;
  /** Descendants of the child alive when SIGTERM was sent; null when unknown. */
  readonly descendantsAtTerm: number | null;
  /** When SIGKILL followed, or null when every member had ended within the grace. */
  readonly killAtMs: number | null;
  /** Whether the child itself was still alive when SIGKILL was sent. */
  readonly childKilled: boolean;
  /** Descendants SIGKILL ended: at the grace's end, or left over after a normal exit. */
  readonly descendantsKilled: number | null;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------------------------
// The supervisor side: this file run by node as its own main module.

function supervise(callPath: string): void {
  // Written by the caller below, in this same file.
  const call: SupervisorCall = JSON.parse(readFileSync(callPath, "utf8"));
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);

  let child: ChildProcess | undefined;
  let pgid: number | null = null;
  let childExit: { status: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: string | null = null;
  let boundReached = false;
  let supervisorSignal: NodeJS.Signals | null = null;
  let termAtMs: number | null = null;
  let descendantsAtTerm: number | null = null;
  let killAtMs: number | null = null;
  let childKilled = false;
  let descendantsKilled: number | null = null;
  let ending = false;
  let killed = false;
  let reported = false;

  // The pids of the group's members, from ps; null when ps cannot answer.
  const members = (): number[] | null => {
    if (pgid === null) return [];
    try {
      const listing = execFileSync("ps", ["-A", "-o", "pid=,pgid="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const pids: number[] = [];
      for (const line of listing.split("\n")) {
        const [pid, group] = line.trim().split(/\s+/).map(Number);
        if (group === pgid && pid !== undefined && Number.isInteger(pid)) pids.push(pid);
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
    const kind: EndingKind =
      spawnError !== null
        ? "spawn-error"
        : supervisorSignal !== null
          ? "supervisor-signal"
          : boundReached
            ? "bound"
            : (childExit?.signal ?? null) !== null
              ? "signal"
              : "exit";
    const ended: SupervisorReport = {
      kind,
      status: childExit?.status ?? null,
      signal: childExit?.signal ?? null,
      elapsedMs: elapsed(),
      supervisorPid: process.pid,
      childPid: child?.pid ?? null,
      pgid,
      supervisorSignal,
      termAtMs,
      descendantsAtTerm,
      killAtMs,
      childKilled,
      descendantsKilled,
      error: spawnError,
    };
    writeFileSync(call.reportPath, JSON.stringify(ended));
    process.exit(0);
  };

  // Reports once the child has exited and, after a SIGTERM to the group, once every member has
  // ended or SIGKILL has followed.
  const reportWhenDone = (): void => {
    if (childExit === undefined && spawnError === null) return;
    if (ending && !killed && groupAlive()) return;
    report();
  };

  // SIGTERM to the group, then SIGKILL to whatever is left once the grace has passed.
  const endGroup = (): void => {
    if (ending) return;
    ending = true;
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

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      supervisorSignal ??= signal;
      endGroup();
    });
  }

  try {
    child = spawn(call.command, [...call.args], {
      ...(call.cwd === null ? {} : { cwd: call.cwd }),
      env: call.env,
      detached: true,
      stdio: "inherit",
    });
  } catch (error) {
    spawnError = error instanceof Error ? error.message : String(error);
    report();
    return;
  }
  if (child.pid !== undefined) {
    pgid = child.pid;
    writeFileSync(call.startedPath, JSON.stringify({ childPid: child.pid, pgid }));
  }
  child.on("error", (error) => {
    if (child?.pid !== undefined) return; // a later error of a started child: its exit reports
    spawnError = error.message;
    report();
  });
  const bound = setTimeout(() => {
    boundReached = true;
    endGroup();
  }, call.boundMs);
  child.on("exit", (status, signal) => {
    childExit = { status, signal };
    if (ending) {
      reportWhenDone();
      return;
    }
    clearTimeout(bound);
    // A normal exit: a member left in the group would hold the caller's pipes open.
    if (groupAlive()) {
      descendantsKilled = descendantsOf(members());
      signalGroup("SIGKILL");
    }
    report();
  });
}

// ---------------------------------------------------------------------------------------------
// The caller side.

interface SpawnOptions {
  /** How long the child may run, in ms: a finite number above 0. Required at every call. */
  readonly boundMs: number;
  readonly cwd?: string;
  /** The child's whole environment; `process.env` when absent. */
  readonly env?: NodeJS.ProcessEnv;
  /** The child's stdin; empty and closed when absent. */
  readonly input?: string | Buffer;
}

interface BoundedExit {
  readonly status: number;
  readonly signal: null;
  readonly stdout: string;
  readonly stderr: string;
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

  const dir = mkdtempSync(join(tmpdir(), "phax-bounded-spawn-"));
  try {
    const call: SupervisorCall = {
      command,
      args,
      cwd: options.cwd ?? null,
      env: definedEnv(options.env ?? process.env),
      boundMs,
      graceMs: GRACE_MS,
      reportPath: join(dir, "report.json"),
      startedPath: join(dir, "started.json"),
    };
    const callPath = join(dir, "call.json");
    writeFileSync(callPath, JSON.stringify(call));
    const supervisorEnv = { ...process.env };
    delete supervisorEnv["NODE_OPTIONS"];
    const safetyMs = boundMs + GRACE_MS + SAFETY_MARGIN_MS;
    const run = spawnSync(process.execPath, [SELF, callPath], {
      input: options.input ?? "",
      stdio: "pipe",
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: safetyMs,
      killSignal: "SIGKILL",
      env: supervisorEnv,
    });
    const stdout = run.stdout ?? "";
    const stderr = run.stderr ?? "";
    const output = streams(stdout, stderr);

    if (!existsSync(call.reportPath)) {
      const started = readStarted(call.startedPath);
      if (started !== undefined) {
        try {
          process.kill(-started.pgid, "SIGKILL");
        } catch {
          // the group has ended
        }
      }
      const how =
        run.error !== undefined
          ? `${run.error.message}${"code" in run.error && run.error.code === "ETIMEDOUT" ? ` (its safety timeout of ${safetyMs} ms passed)` : ""}`
          : run.signal !== null
            ? `it was ended by ${run.signal}`
            : `it exited with status ${String(run.status)}`;
      throw new BoundedSpawnError(
        `bounded spawn: \`${line}\` gave no report: its supervisor ended without one: ${how}\n${output}`,
        started?.childPid,
      );
    }

    // Written by the supervisor above, in this same file.
    const report: SupervisorReport = JSON.parse(readFileSync(call.reportPath, "utf8"));
    const fail = (lines: string): BoundedSpawnError =>
      new BoundedSpawnError(
        `bounded spawn: \`${line}\` ${lines}\n${output}`,
        report.childPid ?? undefined,
      );
    const foreign = (signal: string): string =>
      `ended by ${signal}, not by its bound (${boundMs} ms)`;

    if (report.kind === "spawn-error") {
      const cwd = options.cwd === undefined ? "" : ` (cwd ${options.cwd})`;
      throw fail(`could not start: ${report.error ?? "unknown error"}${cwd}`);
    }
    if (report.kind === "bound") {
      throw fail(`reached its bound (${boundMs} ms) and was ended by it\n  ${groupEnding(report)}`);
    }
    if (report.kind === "supervisor-signal") {
      const signal = report.supervisorSignal ?? "a signal";
      throw fail(
        `${foreign(signal)}\n  the supervisor itself received ${signal} after ` +
          `${report.termAtMs ?? report.elapsedMs} ms and ended the child: ${groupEnding(report)}`,
      );
    }
    if (report.kind === "signal") {
      const signal = report.signal ?? "SIGKILL";
      if (signal === options.expectSignal) return { status: null, signal, stdout, stderr };
      throw fail(
        `${foreign(signal)}\n  the child received ${signal} from outside the bounded spawn ` +
          `after ${report.elapsedMs} ms`,
      );
    }
    const status = report.status ?? 0;
    const relayed = isCliSpawn(args) ? relayedSignal(status) : undefined;
    if (relayed !== undefined && relayed === options.expectSignal) {
      return { status: null, signal: relayed, stdout, stderr };
    }
    if (relayed !== undefined) {
      throw fail(
        `${foreign(relayed)}\n  sent through ${displayCommand(command)}: exit status ${status}, ` +
          `after ${report.elapsedMs} ms`,
      );
    }
    return { status, signal: null, stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined) defined[name] = value;
  return defined;
}

function readStarted(path: string): { childPid: number; pgid: number } | undefined {
  try {
    // Written by the supervisor above, in this same file.
    const started: { childPid: number; pgid: number } = JSON.parse(readFileSync(path, "utf8"));
    return started;
  } catch {
    return undefined;
  }
}

function isCliSpawn(args: readonly string[]): boolean {
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

function groupEnding(report: SupervisorReport): string {
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

if (import.meta.main) {
  const callPath = process.argv[2];
  if (callPath === undefined) {
    process.stderr.write(`usage: node ${basename(SELF)} <call file>\n`);
    process.exit(2);
  }
  supervise(callPath);
}
