import { Effect, Either } from "effect";
import { join } from "node:path";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { GateFailedError } from "../domain/errors.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodeRunStatus, encodeRunStatus } from "../schemas/status.js";

export interface GateOutcome {
  readonly attemptLogPath: string;
}

export function resolveGateProfile(
  config: ResolvedConfig,
  profileId: string,
  workspaceId?: string,
): readonly string[] {
  if (workspaceId !== undefined) {
    const workspace = config.raw.workspaces?.find((w) => w.id === workspaceId);
    const wsProfile = workspace?.gateProfiles?.[profileId];
    if (wsProfile !== undefined && wsProfile.length > 0) {
      return wsProfile;
    }
  }
  const profile = config.raw.gateProfiles[profileId];
  if (profile === undefined || profile.length === 0) {
    throw new Error(`Gate profile "${profileId}" not found or empty`);
  }
  return profile;
}

function parseCommandTokens(raw: string): readonly [string, ...string[]] {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (parts.length === 0 || first === undefined) {
    throw new Error(`Empty gate command: "${raw}"`);
  }
  return [first, ...parts.slice(1)];
}

export function runGates(
  commands: readonly string[],
  cwd: string,
  attemptLogPath: string,
): Effect.Effect<GateOutcome, GateFailedError | FsError | ShellError, Shell | FileSystem> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const logLines: string[] = [];

    for (const rawCommand of commands) {
      const command = parseCommandTokens(rawCommand);
      logLines.push(`$ ${rawCommand}`);

      const result = yield* shell.run({ command, cwd });

      if (result.stdout) logLines.push(result.stdout.trimEnd());
      if (result.stderr) logLines.push(result.stderr.trimEnd());
      logLines.push(`exit ${result.exitCode}`);
      logLines.push("");

      if (result.exitCode !== 0) {
        yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
        return yield* Effect.fail(
          new GateFailedError({
            message: `Gate command failed: ${rawCommand} (exit ${result.exitCode})`,
            command: rawCommand,
            exitCode: result.exitCode,
            logPath: attemptLogPath,
          }),
        );
      }
    }

    yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
    return { attemptLogPath };
  });
}

export function recordGateProfileInRunStatus(
  runPath: string,
  profileId: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(runPath, "run-status.json");
    const raw = yield* fs.readText(statusPath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    const decoded = decodeRunStatus(parsed);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        gateProfileId: profileId,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodeRunStatus(updated), null, 2));
    }
  });
}
