import { Effect, Either } from "effect";
import { join } from "node:path";
import type { GateStep, ResolvedConfig } from "../schemas/phaxConfig.js";
import { GateFailedError } from "../domain/errors.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodeRunStatus, encodeRunStatus } from "../schemas/status.js";
import { encodeGateAttribution, type GateStepResult } from "../schemas/gateAttribution.js";
import {
  decodeGateDiagnosticsDocument,
  encodeGateDiagnosticsDocument,
  type GateDiagnostic,
  type GateDiagnosticsDocument,
} from "../schemas/gateDiagnostics.js";
import { formatParseError } from "../schemas/formatError.js";
import { diagnosticsPathFor } from "../domain/gate/diagnosticsPath.js";

export interface GateOutcome {
  readonly attemptLogPath: string;
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

export interface RunGatesOptions {
  readonly steps: readonly GateStep[];
  readonly cwd: string;
  readonly attemptLogPath: string;
  /** When provided together with `phaseId`, the steps that ran (up to and
   *  including the first failure) are recorded here as a GateAttribution. */
  readonly attributionPath?: string;
  readonly phaseId?: string;
}

export function runGates(
  opts: RunGatesOptions,
): Effect.Effect<GateOutcome, GateFailedError | FsError | ShellError, Shell | FileSystem> {
  const { steps, cwd, attemptLogPath, attributionPath, phaseId } = opts;
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const logLines: string[] = [];
    const stepResults: GateStepResult[] = [];

    function writeAttribution(): Effect.Effect<void, FsError> {
      if (attributionPath === undefined || phaseId === undefined) {
        return Effect.void;
      }
      return fs.writeAtomic(
        attributionPath,
        JSON.stringify(encodeGateAttribution({ phase: phaseId, steps: stepResults }), null, 2),
      );
    }

    /** Persist the transcript + attribution, optionally the diagnostics
     *  document, and fail the gate. Called once a step is judged to have
     *  failed; the caller has already recorded the `fail` step result. */
    function failGate(params: {
      readonly rawCommand: string;
      readonly exitCode: number;
      readonly message: string;
      readonly diagnostics: readonly GateDiagnostic[];
      readonly stderr: string;
      readonly document?: GateDiagnosticsDocument;
    }): Effect.Effect<never, GateFailedError | FsError> {
      return Effect.gen(function* () {
        yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
        if (params.document !== undefined) {
          yield* fs.writeAtomic(
            diagnosticsPathFor(attemptLogPath),
            JSON.stringify(encodeGateDiagnosticsDocument(params.document), null, 2),
          );
        }
        yield* writeAttribution();
        return yield* Effect.fail(
          new GateFailedError({
            message: params.message,
            command: params.rawCommand,
            exitCode: params.exitCode,
            logPath: attemptLogPath,
            diagnostics: params.diagnostics,
            ...(params.stderr ? { stderrExcerpt: params.stderr } : {}),
          }),
        );
      });
    }

    for (const step of steps) {
      const rawCommand = step.command;
      const command = parseCommandTokens(rawCommand);
      logLines.push(`$ ${rawCommand}`);

      const result = yield* shell.run({ command, cwd });

      if (result.stdout) logLines.push(result.stdout.trimEnd());
      if (result.stderr) logLines.push(result.stderr.trimEnd());
      logLines.push(`exit ${result.exitCode}`);
      logLines.push("");

      if (step.output === "diagnostics") {
        // The step promised a diagnostics document on stdout. Decode it; the
        // verdict comes from the document, not the exit code.
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.stdout) as unknown;
        } catch (cause) {
          const reason = `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`;
          logLines.push(
            `provider error: step declared diagnostics output but returned none: ${reason}`,
          );
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate step "${rawCommand}" declared diagnostics output but returned none: ${reason}`,
            diagnostics: [],
            stderr: result.stderr,
          });
        }

        const decoded = decodeGateDiagnosticsDocument(parsed);
        if (Either.isLeft(decoded)) {
          const reason = `schema mismatch: ${formatParseError(decoded.left)}`;
          logLines.push(
            `provider error: step declared diagnostics output but returned none: ${reason}`,
          );
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate step "${rawCommand}" declared diagnostics output but returned none: ${reason}`,
            diagnostics: [],
            stderr: result.stderr,
          });
        }

        const document = decoded.right;

        if (document.diagnostics.length === 0) {
          if (result.exitCode === 0) {
            stepResults.push({ command: rawCommand, surface: step.surface, result: "pass" });
            continue;
          }
          const message = `Gate step "${rawCommand}" exited ${result.exitCode} with no diagnostics`;
          logLines.push(`provider error: ${message}`);
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message,
            diagnostics: [],
            stderr: result.stderr,
          });
        }

        // A non-empty list fails the step whatever the exit code (spec §9).
        stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
        return yield* failGate({
          rawCommand,
          exitCode: result.exitCode,
          message: `Gate command failed: ${rawCommand} (${document.diagnostics.length} diagnostic(s))`,
          diagnostics: document.diagnostics,
          stderr: result.stderr,
          document,
        });
      }

      if (result.exitCode !== 0) {
        stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
        return yield* failGate({
          rawCommand,
          exitCode: result.exitCode,
          message: `Gate command failed: ${rawCommand} (exit ${result.exitCode})`,
          diagnostics: [],
          stderr: result.stderr,
        });
      }

      stepResults.push({ command: rawCommand, surface: step.surface, result: "pass" });
    }

    yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
    yield* writeAttribution();
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
