import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Shell } from "../../src/ports/shell.js";

const run = (command: readonly [string, ...string[]], stdin?: string, timeoutMs?: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const shell = yield* Shell;
      return yield* shell.run({
        command,
        cwd: process.cwd(),
        ...(stdin !== undefined ? { stdin } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
    }).pipe(Effect.provide(NodeShellLayer)),
  );

const runEither = (command: readonly [string, ...string[]], timeoutMs: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const shell = yield* Shell;
      return yield* Effect.either(shell.run({ command, cwd: process.cwd(), timeoutMs }));
    }).pipe(Effect.provide(NodeShellLayer)),
  );

describe("NodeShellLayer stdin", () => {
  it("pipes stdin to the child", async () => {
    const result = await run(
      [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
      "hello from stdin",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello from stdin");
  });

  // A child that exits before draining stdin makes the write fail with EPIPE.
  // An unhandled `error` on the stdin stream is an uncaught exception that
  // takes the whole process down instead of surfacing to the caller.
  it("survives a child that exits without reading a large stdin payload", async () => {
    const payload = "x".repeat(1_000_000);

    const result = await run([process.execPath, "-e", "process.exit(3)"], payload);

    expect(result.exitCode).toBe(3);
  });
});

describe("NodeShellLayer timeout", () => {
  it("leaves a command that finishes inside its cap alone", async () => {
    const result = await run([process.execPath, "-e", "process.exit(0)"], undefined, 30_000);

    expect(result.exitCode).toBe(0);
  });

  // A provider that never exits must not wedge its caller: the timer frees the
  // promise itself rather than waiting on a `close` the child may never emit.
  it("fails a command that outlives its cap, naming the expiry", async () => {
    const result = await runEither([process.execPath, "-e", "setInterval(() => {}, 1000)"], 250);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("timed out after 250ms");
    }
  });

  it("frees the caller even when the child ignores SIGTERM", async () => {
    const started = Date.now();
    const result = await runEither(
      [process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      250,
    );

    expect(Either.isLeft(result)).toBe(true);
    // The SIGKILL grace is 5s; the caller must not have waited for it.
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
