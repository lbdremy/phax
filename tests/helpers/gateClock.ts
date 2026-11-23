import { Clock, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { FileSystem, type FileSystemOps } from "../../src/ports/fs.js";
import { Git, type GitOps } from "../../src/ports/git.js";
import { Shell, type ShellOps, type ShellRunOptions } from "../../src/ports/shell.js";

// A fixed clock for the gate's times: Effect's TestClock, which only moves when
// a test advances it. A test provides it to the effect under test with
// `provide`, and advances it only inside the port wrappers below, so a figure
// phax records is exactly the sum of the advances that fell inside it. No real
// time is read: a real shell or git may run under it, and takes no time at all.

/** The fixed clock's first instant: 2026-01-01T09:00:00.000Z. */
const GATE_CLOCK_START_MS = Date.UTC(2026, 0, 1, 9, 0, 0, 0);

export interface GateClock {
  /** The clock's current instant, in milliseconds since the epoch. */
  readonly now: () => number;
  /** An instant as phax records it: ISO-8601 UTC with milliseconds. */
  readonly iso: (ms: number) => string;
  /** Moves the clock forward by `ms` (nothing for 0). Runs in any effect. */
  readonly advance: (ms: number) => Effect.Effect<void>;
  /** `effect` with this clock as Effect's `Clock`. */
  readonly provide: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

/** A fixed clock standing at `startMs`. */
export async function makeGateClock(startMs: number = GATE_CLOCK_START_MS): Promise<GateClock> {
  const testClock = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const made = yield* TestClock.make();
        yield* made.setTime(startMs);
        return made;
      }),
    ),
  );
  return {
    now: () => testClock.currentTimeMillisUnsafe(),
    iso: (ms) => new Date(ms).toISOString(),
    advance: (ms) => (ms === 0 ? Effect.void : testClock.adjust(ms)),
    provide: (effect) => Effect.provideService(effect, Clock.Clock, testClock),
  };
}

/** `inner` with the members of `overrides` in place of its own; every other
 *  method is the inner's, bound to it (a fake's class methods keep their `this`). */
function overriding<T extends object>(inner: T, overrides: Partial<T>): T {
  return new Proxy(inner, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key) as unknown;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** `inner`'s Shell, whose `run` advances the clock by `advanceFor(options)`
 *  before it answers: on success, and on a spawn failure or a timeout alike. */
function clockedShell(
  clock: GateClock,
  inner: ShellOps,
  advanceFor: (options: ShellRunOptions) => number,
): ShellOps {
  return overriding(inner, {
    run: (options) => clock.advance(advanceFor(options)).pipe(Effect.andThen(inner.run(options))),
  });
}

/** `clockedShell` over the Shell `inner` provides. */
export function clockedShellLayer(
  clock: GateClock,
  inner: Layer.Layer<Shell>,
  advanceFor: (options: ShellRunOptions) => number,
): Layer.Layer<Shell> {
  return Layer.effect(
    Shell,
    Effect.map(Shell, (shell) => clockedShell(clock, shell, advanceFor)),
  ).pipe(Layer.provide(inner));
}

/** `inner`'s FileSystem, whose `writeAtomic` of a path advances the clock by
 *  `advanceFor(path)` before it writes. */
function clockedFileSystem(
  clock: GateClock,
  inner: FileSystemOps,
  advanceFor: (path: string) => number,
): FileSystemOps {
  return overriding(inner, {
    writeAtomic: (path, content) =>
      clock.advance(advanceFor(path)).pipe(Effect.andThen(inner.writeAtomic(path, content))),
  });
}

/** `clockedFileSystem` over the FileSystem `inner` provides. */
export function clockedFileSystemLayer(
  clock: GateClock,
  inner: Layer.Layer<FileSystem>,
  advanceFor: (path: string) => number,
): Layer.Layer<FileSystem> {
  return Layer.effect(
    FileSystem,
    Effect.map(FileSystem, (fs) => clockedFileSystem(clock, fs, advanceFor)),
  ).pipe(Layer.provide(inner));
}

/** `inner`'s Git, whose `observeWorktree` advances the clock by `observeMs`
 *  before it answers. */
function clockedGit(clock: GateClock, inner: GitOps, observeMs: number): GitOps {
  return overriding(inner, {
    observeWorktree: (path, base, isProtected) =>
      clock.advance(observeMs).pipe(Effect.andThen(inner.observeWorktree(path, base, isProtected))),
  });
}

/** `clockedGit` over the Git `inner` provides. */
export function clockedGitLayer(
  clock: GateClock,
  inner: Layer.Layer<Git>,
  observeMs: number,
): Layer.Layer<Git> {
  return Layer.effect(
    Git,
    Effect.map(Git, (git) => clockedGit(clock, git, observeMs)),
  ).pipe(Layer.provide(inner));
}
