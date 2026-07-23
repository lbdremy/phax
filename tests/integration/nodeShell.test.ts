import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Shell } from "../../src/ports/shell.js";

const run = (command: readonly [string, ...string[]], stdin?: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const shell = yield* Shell;
      return yield* shell.run({
        command,
        cwd: process.cwd(),
        ...(stdin !== undefined ? { stdin } : {}),
      });
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
