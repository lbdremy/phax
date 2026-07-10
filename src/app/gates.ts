import { Effect, Either } from "effect";
import { join } from "node:path";
import type { GateStep, ResolvedConfig } from "../schemas/phaxConfig.js";
import { GateFailedError } from "../domain/errors.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodeRunStatus, encodeRunStatus } from "../schemas/status.js";
import { encodeGateAttribution } from "../schemas/gateAttribution.js";

export interface GateOutcome {
  readonly attemptLogPath: string;
}

export interface RunGatesOptions {
  readonly steps: readonly GateStep[];
  readonly cwd: string;
  readonly attemptLogPath: string;
  readonly attributionPath?: string;
  readonly phaseId?: string;
}

export function resolveGateProfile(
  config: ResolvedConfig,
  profileId: string,
  workspaceId?: string,
): readonly GateStep[] {
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
  opts: RunGatesOptions,
): Effect.Effect<GateOutcome, GateFailedError | FsError | ShellError, Shell | FileSystem> {
  const { steps, cwd, attemptLogPath, attributionPath, phaseId } = opts;
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const logLines: string[] = [];
    const attributedSteps: Array<{ command: string; surface: string; result: "pass" | "fail" }> =
      [];

    for (const step of steps) {
      const rawCommand = step.command;
      const command = parseCommandTokens(rawCommand);
      logLines.push(`$ ${rawCommand}`);

      const result = yield* shell.run({ command, cwd });

      if (result.stdout) logLines.push(result.stdout.trimEnd());
      if (result.stderr) logLines.push(result.stderr.trimEnd());
      logLines.push(`exit ${result.exitCode}`);
      logLines.push("");

      if (result.exitCode !== 0) {
        attributedSteps.push({ command: rawCommand, surface: step.surface, result: "fail" });
        if (attributionPath !== undefined && phaseId !== undefined) {
          yield* fs.writeAtomic(
            attributionPath,
            JSON.stringify(
              encodeGateAttribution({ phase: phaseId, steps: attributedSteps }),
              null,
              2,
            ),
          );
        }
        yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
        return yield* Effect.fail(
          new GateFailedError({
            message: `Gate command failed: ${rawCommand} (exit ${result.exitCode})`,
            command: rawCommand,
            exitCode: result.exitCode,
            logPath: attemptLogPath,
            ...(result.stderr ? { stderrExcerpt: result.stderr } : {}),
          }),
        );
      }

      attributedSteps.push({ command: rawCommand, surface: step.surface, result: "pass" });
    }

    if (attributionPath !== undefined && phaseId !== undefined) {
      yield* fs.writeAtomic(
        attributionPath,
        JSON.stringify(encodeGateAttribution({ phase: phaseId, steps: attributedSteps }), null, 2),
      );
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
