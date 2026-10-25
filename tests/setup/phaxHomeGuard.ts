// Every unit and integration suite runs with a guard on the real `~/.phax`:
// the path-taking `node:fs` and `node:fs/promises` calls of the test process
// refuse any path inside it (EACCES, in the call's own style), record the
// refusal, and a global `afterEach` fails the test even when the code under test
// swallowed the error. The remedy for a refused suite is
// `tests/helpers/isolatePhaxHome.ts`.
//
// Not used by vitest.e2e.config.ts: the real e2e drives real providers.
//
// Only the test process's own `node:fs` calls are watched. A child process (git,
// a spawned `phax`) or a native addon reaching `~/.phax` is not caught, so a
// spawned CLI child gets a temporary HOME through `phaxHomeEnv()` instead.
//
// The repository under test is exempt: phase worktrees live under
// `~/.phax/worktrees/`, so the gate's `pnpm test` runs inside `~/.phax`, and a
// guard without the exemption would refuse every read of the repository itself.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { userInfo } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

export interface GuardViolation {
  readonly call: string;
  readonly path: string;
}

interface GuardState {
  readonly violations: GuardViolation[];
  readonly originals: Map<string, unknown>;
}

const STATE_KEY = Symbol.for("phax.phaxHomeGuard");

const REMEDY = "Isolate the suite with tests/helpers/isolatePhaxHome.ts.";

type Style = "sync" | "callback" | "promise" | "stream";

interface Entry {
  readonly name: string;
  /** Indexes of the arguments that are paths. */
  readonly paths: readonly number[];
}

const one = (name: string): Entry => ({ name, paths: [0] });
const two = (name: string): Entry => ({ name, paths: [0, 1] });

// The names that exist as `<name>Sync`, `<name>` (callback) and
// `promises.<name>` unless noted.
const SINGLE_PATH = [
  "readFile",
  "writeFile",
  "appendFile",
  "stat",
  "lstat",
  "access",
  "open",
  "opendir",
  "readdir",
  "mkdir",
  "mkdtemp",
  "rm",
  "rmdir",
  "unlink",
  "readlink",
  "chmod",
  "utimes",
  "truncate",
  "realpath",
] as const;
const TWO_PATH = ["rename", "copyFile", "cp", "symlink", "link"] as const;

// `exists` has no promise form; the streams have no sync or promise form.
const SYNC_ENTRIES: readonly Entry[] = [
  ...SINGLE_PATH.map((n) => one(`${n}Sync`)),
  one("existsSync"),
  ...TWO_PATH.map((n) => two(`${n}Sync`)),
];
const CALLBACK_ENTRIES: readonly Entry[] = [
  ...SINGLE_PATH.map(one),
  one("exists"),
  ...TWO_PATH.map(two),
];
const PROMISE_ENTRIES: readonly Entry[] = [...SINGLE_PATH.map(one), ...TWO_PATH.map(two)];
const STREAM_ENTRIES: readonly Entry[] = [one("createReadStream"), one("createWriteStream")];

/** True when `path` is the root or lies below it. */
function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * True when `path` is the phax home or below it and is not inside an exempted
 * root. Siblings such as `~/.phaxx` and `~/.phax-backup` are outside.
 */
export function isInsidePhaxHome(
  path: string,
  phaxRoot: string,
  exemptRoots: readonly string[],
): boolean {
  const target = resolve(path);
  if (!within(target, resolve(phaxRoot))) return false;
  return !exemptRoots.some((root) => within(target, resolve(root)));
}

// The real home comes from the passwd entry, not from HOME, which suites stub.
const PHAX_ROOT = join(userInfo().homedir, ".phax");

function realOrSelf(path: string): string {
  try {
    return fs.realpathSync(path);
  } catch {
    return path;
  }
}

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXEMPT_ROOTS: readonly string[] = [...new Set([REPO_ROOT, realOrSelf(REPO_ROOT)])];

function state(): GuardState {
  const holder = globalThis as unknown as Record<symbol, GuardState | undefined>;
  let existing = holder[STATE_KEY];
  if (existing === undefined) {
    existing = { violations: [], originals: new Map() };
    holder[STATE_KEY] = existing;
  }
  return existing;
}

/** The absolute path an argument names, or undefined for a file descriptor or anything else. */
function resolveArg(arg: unknown): string | undefined {
  if (typeof arg === "string") return isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  if (Buffer.isBuffer(arg)) return resolve(process.cwd(), arg.toString());
  if (arg instanceof URL) {
    try {
      return fileURLToPath(arg);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The guarded path among a call's path arguments, if any. */
function guardedPath(args: readonly unknown[], indexes: readonly number[]): string | undefined {
  for (const index of indexes) {
    const path = resolveArg(args[index]);
    if (path !== undefined && isInsidePhaxHome(path, PHAX_ROOT, EXEMPT_ROOTS)) return path;
  }
  return undefined;
}

function refusal(call: string, path: string): Error {
  state().violations.push({ call, path });
  return Object.assign(new Error(`EACCES: ${call} ${path} is inside the real ~/.phax. ${REMEDY}`), {
    code: "EACCES",
    syscall: call,
    path,
  });
}

function wrap(
  original: (...args: unknown[]) => unknown,
  entry: Entry,
  style: Style,
  label: string,
): (...args: unknown[]) => unknown {
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const path = guardedPath(args, entry.paths);
    if (path === undefined) return original.apply(this, args);
    const error = refusal(label, path);
    switch (style) {
      case "sync":
        throw error;
      case "promise":
        return Promise.reject(error);
      case "callback": {
        const callback = args.find((arg) => typeof arg === "function") as
          | ((...cbArgs: unknown[]) => void)
          | undefined;
        // fs.exists reports a boolean only, never an error.
        process.nextTick(() => callback?.(entry.name === "exists" ? false : error));
        return undefined;
      }
      case "stream": {
        if (entry.name === "createWriteStream") {
          const stream = new Writable({ write: (_chunk, _encoding, done) => done(error) });
          process.nextTick(() => stream.destroy(error));
          return stream;
        }
        const stream = new Readable({ read: () => {} });
        process.nextTick(() => stream.destroy(error));
        return stream;
      }
    }
  };
  // Keep what callers rely on: util.promisify.custom, `.native`.
  for (const symbol of Object.getOwnPropertySymbols(original)) {
    Object.defineProperty(wrapped, symbol, Object.getOwnPropertyDescriptor(original, symbol)!);
  }
  return wrapped;
}

function patch(
  target: Record<string, unknown>,
  prefix: string,
  entries: readonly Entry[],
  style: Style,
): void {
  const { originals } = state();
  for (const entry of entries) {
    const original = target[entry.name];
    if (typeof original !== "function") continue;
    const label = `${prefix}${entry.name}`;
    originals.set(label, original);
    const wrapped = wrap(original as (...args: unknown[]) => unknown, entry, style, label);
    const native = (original as { native?: unknown }).native;
    if (typeof native === "function") {
      originals.set(`${label}.native`, native);
      (wrapped as unknown as { native: unknown }).native = wrap(
        native as (...args: unknown[]) => unknown,
        entry,
        style,
        `${label}.native`,
      );
    }
    target[entry.name] = wrapped;
  }
}

/**
 * Wrap the path-taking `node:fs` and `node:fs/promises` calls. Idempotent: the
 * install is marked on `fs` with a global symbol, so a second call wraps nothing.
 */
export function installPhaxHomeGuard(): void {
  const marked = fs as unknown as Record<symbol, boolean | undefined>;
  if (marked[STATE_KEY] === true) return;
  const target = fs as unknown as Record<string, unknown>;
  patch(target, "fs.", SYNC_ENTRIES, "sync");
  patch(target, "fs.", CALLBACK_ENTRIES, "callback");
  patch(target, "fs.", STREAM_ENTRIES, "stream");
  patch(
    fs.promises as unknown as Record<string, unknown>,
    "fs.promises.",
    PROMISE_ENTRIES,
    "promise",
  );
  Object.defineProperty(fs, STATE_KEY, { value: true });
  // So ESM named and namespace imports of node:fs and node:fs/promises see the wrappers.
  syncBuiltinESMExports();
}

/** Drain and return the refusals recorded so far. */
export function takeGuardViolations(): GuardViolation[] {
  return state().violations.splice(0);
}

/** Drain the recorded refusals and throw one error listing them, if there are any. */
export function assertNoGuardViolations(): void {
  const violations = takeGuardViolations();
  if (violations.length === 0) return;
  throw new Error(
    `The test touched the real ~/.phax:\n${violations
      .map((v) => `  ${v.call} ${v.path}`)
      .join("\n")}\n${REMEDY}`,
  );
}

installPhaxHomeGuard();

afterEach(() => {
  assertNoGuardViolations();
});
