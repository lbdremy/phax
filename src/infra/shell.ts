import { Effect, Layer } from "effect";
import { spawn } from "node:child_process";
import { Shell, ShellError } from "../ports/shell.js";

function spawnCommand(
  command: readonly [string, ...string[]],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [executable, ...args] = command;
    const proc = spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

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
  });
}

export const NodeShellLayer = Layer.succeed(Shell, {
  run: (options) =>
    Effect.tryPromise({
      try: () => spawnCommand(options.command, options.cwd),
      catch: (err): ShellError =>
        new ShellError({
          message: err instanceof Error ? err.message : String(err),
          cause: err,
          argv: [...options.command],
        }),
    }),
});
