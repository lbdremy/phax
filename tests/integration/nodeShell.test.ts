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

/** A child script writing each byte group on `stream`, 50 ms apart, so each lands in its own chunk. */
function splitWrites(stream: "stdout" | "stderr", ...groups: readonly number[][]): string {
  return [
    `const groups = ${JSON.stringify(groups)};`,
    "let i = 0;",
    `const next = () => { if (i < groups.length) { process.${stream}.write(Buffer.from(groups[i++])); setTimeout(next, 50); } };`,
    "next();",
  ].join("\n");
}

describe("NodeShellLayer decoding", () => {
  it("decodes a two-byte character split across two writes on stdout", async () => {
    const result = await run([process.execPath, "-e", splitWrites("stdout", [0xc3], [0xa9])]);

    expect(result.stdout).toBe("é");
    expect(result.stdout).not.toContain("�");
    expect(result.stdoutEncoding).toBe("utf8");
  });

  it("decodes a three-byte character split across two writes on stdout and on stderr", async () => {
    const out = await run([process.execPath, "-e", splitWrites("stdout", [0xe2, 0x9c], [0x93])]);
    const err = await run([process.execPath, "-e", splitWrites("stderr", [0xe2], [0x9c, 0x93])]);

    expect(out.stdout).toBe("✓");
    expect(out.stdoutEncoding).toBe("utf8");
    expect(err.stderr).toBe("✓");
    expect(err.stderr).not.toContain("�");
  });

  it("keeps a leading byte order mark", async () => {
    const result = await run([
      process.execPath,
      "-e",
      splitWrites("stdout", [0xef, 0xbb, 0xbf, 0x41]),
    ]);

    expect(result.stdout).toBe("﻿A");
    expect(result.stdoutEncoding).toBe("utf8");
  });

  it("flags stdout bytes that are not UTF-8", async () => {
    const result = await run([process.execPath, "-e", splitWrites("stdout", [0xff, 0xfe, 0x41])]);

    expect(result.stdoutEncoding).toBe("invalid-utf8");
  });
});
