import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import { Shell, ShellError } from "../ports/shell.js";

function spawnCommand(
  command: readonly [string, ...string[]],
  cwd: string,
  stdin?: string,
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

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf });
    });

    proc.on("error", (err) => {
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
      try: () => spawnCommand(options.command, options.cwd, options.stdin),
      catch: (err): ShellError =>
        new ShellError({
          message: err instanceof Error ? err.message : String(err),
          cause: err,
          argv: [...options.command],
        }),
    }),
});
