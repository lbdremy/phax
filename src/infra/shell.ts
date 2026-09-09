import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import { Shell, ShellError } from "../ports/shell.js";

// Grace between asking a timed-out child to stop and forcing it, so a process
// that ignores SIGTERM never outlives the CLI.
const SIGKILL_GRACE_MS = 5_000;

function spawnCommand(
  command: readonly [string, ...string[]],
  cwd: string,
  stdin?: string,
  timeoutMs?: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [executable, ...args] = command;
    const proc =
      stdin !== undefined
        ? spawn(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
        : spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    let stdoutBuf = "";
    let stderrBuf = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });

    // Rejecting on the timer rather than waiting for `close` means a child that
    // ignores SIGTERM still frees the caller; the later `close` lands on an
    // already-settled promise and is a no-op.
    const killTimer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            proc.kill("SIGTERM");
            setTimeout(() => proc.kill("SIGKILL"), SIGKILL_GRACE_MS).unref();
            reject(new Error(`timed out after ${timeoutMs}ms: ${command.join(" ")}`));
          }, timeoutMs)
        : undefined;

    proc.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({ exitCode: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf });
    });

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    if (stdin !== undefined) {
      // A child that exits before draining stdin makes the write fail with
      // EPIPE. An unhandled `error` on this stream is an uncaught exception —
      // it never reaches the caller — so swallow it and let the `close`
      // handler report the real exit code instead.
      proc.stdin!.on("error", () => {});
      proc.stdin!.write(stdin);
      proc.stdin!.end();
    }
  });
}

export const NodeShellLayer = Layer.succeed(Shell, {
  run: (options) =>
    Effect.tryPromise({
      try: () => spawnCommand(options.command, options.cwd, options.stdin, options.timeoutMs),
      catch: (err): ShellError =>
        new ShellError({
          message: err instanceof Error ? err.message : String(err),
          cause: err,
          argv: [...options.command],
        }),
    }),
});
