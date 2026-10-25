// Every unit and integration suite runs with a guard on the real `~/.phax`:
// the path-taking `node:fs` and `node:fs/promises` calls of the test process
// refuse any path inside it (EACCES, in the call's own style), record the
// refusal, and a global `afterEach` fails the test even when the code under test
// swallowed the error. A global `afterAll` reports what no `afterEach` saw: a
// refusal in an `afterAll`, or in a file whose tests were all skipped. A
// refusal recorded before the file's first hook is labeled "during
// collection". The remedy for a refused suite is
// `tests/helpers/isolatePhaxHome.ts`.
//
// `~/.phax` is guarded at its path and at its realpath, so a symlinked one is
// refused through its target too. On darwin, paths are compared case-folded:
// APFS and HFS+ volumes are case-insensitive by default, so `~/.PHAX` is the
// same folder there. A case-sensitive volume on darwin is then over-guarded,
// which only refuses a sibling such as `~/.PHAX` that no test has a reason to
// touch.
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
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { userInfo } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll } from "vitest";

export interface GuardViolation {
  readonly call: string;
  readonly path: string;
  /** Before the file's first hook ran (its modules loading), or once its hooks and tests ran. */
  readonly during: "collection" | "test";
}

interface GuardState {
  readonly violations: GuardViolation[];
  readonly originals: Map<string, unknown>;
  collecting: boolean;
}

const STATE_KEY = Symbol.for("phax.phaxHomeGuard");

const REMEDY = "Isolate the suite with tests/helpers/isolatePhaxHome.ts.";

// `asyncIterable` is `fs.promises.glob` and `fs.promises.watch`, which fail on
// iteration; `statWatcher` is `fs.watchFile`, which has no error channel.
type Style = "sync" | "callback" | "promise" | "stream" | "asyncIterable" | "statWatcher";

interface Entry {
  readonly name: string;
  /** The arguments, or parts of them, that name paths. */
  readonly pathsOf: (args: readonly unknown[]) => readonly unknown[];
}

const one = (name: string): Entry => ({ name, pathsOf: (args) => [args[0]] });
const two = (name: string): Entry => ({ name, pathsOf: (args) => [args[0], args[1]] });
const globbing = (name: string): Entry => ({ name, pathsOf: globPaths });

// A glob's pattern or patterns, each relative one resolved against the
// `cwd` option when given, and that `cwd` itself.
function globPaths(args: readonly unknown[]): readonly unknown[] {
  const [pattern, options] = args;
  const cwd =
    typeof options === "object" && options !== null
      ? (options as { readonly cwd?: unknown }).cwd
      : undefined;
  const base = resolveArg(cwd);
  const patterns: readonly unknown[] = Array.isArray(pattern) ? pattern : [pattern];
  return [
    ...patterns.map((p) =>
      typeof p === "string" && base !== undefined && !isAbsolute(p) ? join(base, p) : p,
    ),
    ...(cwd === undefined ? [] : [cwd]),
  ];
}

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
  "statfs",
  "chown",
  "lchown",
  "lchmod",
  "lutimes",
] as const;
const TWO_PATH = ["rename", "copyFile", "cp", "symlink", "link"] as const;

// `exists` has no promise form; the streams have no sync or promise form.
// `watch` throws synchronously on `fs` and is an async iterable on
// `fs.promises`; `glob` is a callback call, `globSync` a sync one and
// `fs.promises.glob` an async iterable. `openAsBlob` returns a promise from
// `fs`. `mkdtempDisposable` has no callback form. A name this Node lacks is
// skipped.
const SYNC_ENTRIES: readonly Entry[] = [
  ...SINGLE_PATH.map((n) => one(`${n}Sync`)),
  one("existsSync"),
  one("mkdtempDisposableSync"),
  one("watch"),
  globbing("globSync"),
  ...TWO_PATH.map((n) => two(`${n}Sync`)),
];
const CALLBACK_ENTRIES: readonly Entry[] = [
  ...SINGLE_PATH.map(one),
  one("exists"),
  globbing("glob"),
  ...TWO_PATH.map(two),
];
const PROMISE_ENTRIES: readonly Entry[] = [
  ...SINGLE_PATH.map(one),
  one("mkdtempDisposable"),
  ...TWO_PATH.map(two),
];
const FS_PROMISE_ENTRIES: readonly Entry[] = [one("openAsBlob")];
const ASYNC_ITERABLE_ENTRIES: readonly Entry[] = [one("watch"), globbing("glob")];
const STREAM_ENTRIES: readonly Entry[] = [one("createReadStream"), one("createWriteStream")];
const STAT_WATCHER_ENTRIES: readonly Entry[] = [one("watchFile")];

/** True when `path` is the root or lies below it. */
function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * True when `path` is one of the phax roots or below one, and is not inside
 * an exempted root. Siblings such as `~/.phaxx` and `~/.phax-backup` are
 * outside. With `foldCase`, paths compare case-insensitively, as on a
 * case-insensitive volume.
 */
export function isInsidePhaxHome(
  path: string,
  phaxRoots: readonly string[],
  exemptRoots: readonly string[],
  foldCase: boolean,
): boolean {
  const norm = (p: string) => (foldCase ? resolve(p).toLowerCase() : resolve(p));
  const target = norm(path);
  if (!phaxRoots.some((root) => within(target, norm(root)))) return false;
  return !exemptRoots.some((root) => within(target, norm(root)));
}

function state(): GuardState {
  const holder = globalThis as unknown as Record<symbol, GuardState | undefined>;
  let existing = holder[STATE_KEY];
  if (existing === undefined) {
    existing = { violations: [], originals: new Map(), collecting: true };
    holder[STATE_KEY] = existing;
  }
  return existing;
}

// The unwrapped call: the guard is installed once per worker, and this file
// loads again for every test file.
function realOrSelf(path: string): string {
  const realpathSync =
    (state().originals.get("fs.realpathSync") as typeof fs.realpathSync | undefined) ??
    fs.realpathSync;
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// The real home comes from the passwd entry, not from HOME, which suites stub.
const PHAX_HOME = join(userInfo().homedir, ".phax");
const PHAX_ROOTS: readonly string[] = [...new Set([PHAX_HOME, realOrSelf(PHAX_HOME)])];
const FOLD_CASE = process.platform === "darwin";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXEMPT_ROOTS: readonly string[] = [...new Set([REPO_ROOT, realOrSelf(REPO_ROOT)])];

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
function guardedPath(args: readonly unknown[], entry: Entry): string | undefined {
  for (const arg of entry.pathsOf(args)) {
    const path = resolveArg(arg);
    if (path !== undefined && isInsidePhaxHome(path, PHAX_ROOTS, EXEMPT_ROOTS, FOLD_CASE)) {
      return path;
    }
  }
  return undefined;
}

function refusal(call: string, path: string): Error {
  const { violations, collecting } = state();
  violations.push({ call, path, during: collecting ? "collection" : "test" });
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
    const path = guardedPath(args, entry);
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
      case "asyncIterable": {
        const iterator: AsyncIterableIterator<never> = {
          [Symbol.asyncIterator]: () => iterator,
          next: () => Promise.reject(error),
          return: () => Promise.resolve({ done: true, value: undefined }),
        };
        return iterator;
      }
      case "statWatcher": {
        // Like a watch on a path that never appears: the watcher never fires.
        const watcher = Object.assign(new EventEmitter(), {
          ref: () => watcher,
          unref: () => watcher,
        });
        return watcher;
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
  const promises = fs.promises as unknown as Record<string, unknown>;
  patch(target, "fs.", SYNC_ENTRIES, "sync");
  patch(target, "fs.", CALLBACK_ENTRIES, "callback");
  patch(target, "fs.", FS_PROMISE_ENTRIES, "promise");
  patch(target, "fs.", STREAM_ENTRIES, "stream");
  patch(target, "fs.", STAT_WATCHER_ENTRIES, "statWatcher");
  patch(promises, "fs.promises.", PROMISE_ENTRIES, "promise");
  patch(promises, "fs.promises.", ASYNC_ITERABLE_ENTRIES, "asyncIterable");
  Object.defineProperty(fs, STATE_KEY, { value: true });
  // So ESM named and namespace imports of node:fs and node:fs/promises see the wrappers.
  syncBuiltinESMExports();
}

/** Drain and return the refusals recorded so far. */
export function takeGuardViolations(): GuardViolation[] {
  return state().violations.splice(0);
}

/**
 * Whether the test file is still being collected: set when this setup file
 * loads, cleared by its first `beforeAll`. Labels the refusals recorded meanwhile.
 */
export function markCollecting(collecting: boolean): void {
  state().collecting = collecting;
}

/** Drain the recorded refusals and throw one error listing them, if there are any. */
export function assertNoGuardViolations(): void {
  const violations = takeGuardViolations();
  if (violations.length === 0) return;
  throw new Error(
    `The test touched the real ~/.phax:\n${violations
      .map((v) => `  ${v.call} ${v.path}${v.during === "collection" ? " (during collection)" : ""}`)
      .join("\n")}\n${REMEDY}`,
  );
}

installPhaxHomeGuard();
markCollecting(true);

beforeAll(() => {
  markCollecting(false);
});

afterEach(() => {
  assertNoGuardViolations();
});

afterAll(() => {
  assertNoGuardViolations();
});
