import { Effect } from "effect";
import { join } from "node:path";
import type { WorktreePath } from "../domain/branded.js";
import { SetupCommandFailedError } from "../domain/errors.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";

function parseCommandTokens(raw: string): readonly [string, ...string[]] {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (parts.length === 0 || first === undefined) {
    throw new Error(`Empty setup command: "${raw}"`);
  }
  return [first, ...parts.slice(1)];
}

export interface SetupPhaseOptions {
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly setupCommands: readonly string[];
}

export function setupPhase(
  opts: SetupPhaseOptions,
): Effect.Effect<void, SetupCommandFailedError | ShellError | FsError, Shell | FileSystem> {
  const { worktreePath, phaseFolderPath, setupCommands } = opts;

  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const logLines: string[] = [];
    const logPath = join(phaseFolderPath, "setup.log");

    for (const rawCommand of setupCommands) {
      let tokens: readonly [string, ...string[]];
      try {
        tokens = parseCommandTokens(rawCommand);
      } catch {
        continue;
      }

      logLines.push(`$ ${rawCommand}`);

      const result = yield* shell.run({
        command: tokens,
        cwd: worktreePath as string,
      });

      if (result.stdout) logLines.push(result.stdout.trimEnd());
      if (result.stderr) logLines.push(result.stderr.trimEnd());
      logLines.push(`exit ${result.exitCode}`);
      logLines.push("");

      if (result.exitCode !== 0) {
        yield* fs.writeAtomic(logPath, logLines.join("\n"));
        return yield* Effect.fail(
          new SetupCommandFailedError({
            message: `Setup command failed: ${rawCommand} (exit ${result.exitCode})`,
            command: rawCommand,
            exitCode: result.exitCode,
            stderr: result.stderr,
          }),
        );
      }
    }

    if (logLines.length > 0) {
      yield* fs.writeAtomic(logPath, logLines.join("\n"));
    }
  });
}
