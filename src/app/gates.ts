import { Effect, Either } from "effect";
import { basename, join } from "node:path";
import type { GateStep, ResolvedConfig } from "../schemas/phaxConfig.js";
import { GateFailedError } from "../domain/errors.js";
import { Shell, type ShellError, type ShellRunResult } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import {
  currentSchemaUrl,
  readGateDiagnosticsAnswer,
  readRunStatusFile,
  withSchemaUrl,
} from "../schemas/persisted.js";
import { encodeRunStatus } from "../schemas/status.js";
import { encodeGateAttributionFile, type GateStepResult } from "../schemas/gateAttribution.js";
import {
  encodeGateDiagnosticsFile,
  type GateDiagnostic,
  type GateDiagnosticsDocument,
} from "../schemas/gateDiagnostics.js";
import { diagnosticsPathFor } from "../domain/gate/diagnosticsPath.js";
import { requestPathFor } from "../domain/gate/gateRequest.js";
import { encodeGateRequestFile, type GateRequest } from "../schemas/gateRequest.js";

export interface GateOutcome {
  readonly attemptLogPath: string;
}

const DIAGNOSTICS_EXPECTED_SHAPE = ` — expected {"$schema": "${currentSchemaUrl("gate-diagnostics")}", "diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]} on stdout`;

/**
 * The exact bytes of a phase's gate request: what a declaring step reads on
 * stdin and what is saved as `checks-attempt-NN.request.json`. Stamped with
 * gate-request's current stamp, two-space indented, no trailing newline.
 */
export function serializeGateRequest(request: GateRequest): string {
  return JSON.stringify(encodeGateRequestFile(withSchemaUrl("gate-request", request)), null, 2);
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
  /** The phase's serialized gate request (`serializeGateRequest`). Written on
   *  the stdin of every step that declares `input: "gate-request"`, and saved
   *  beside the attempt log before the attempt's first declaring step. */
  readonly gateRequest: string;
}

export function runGates(
  opts: RunGatesOptions,
): Effect.Effect<GateOutcome, GateFailedError | FsError | ShellError, Shell | FileSystem> {
  const { steps, cwd, attemptLogPath, attributionPath, phaseId, gateRequest } = opts;
  const requestPath = requestPathFor(attemptLogPath);
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const logLines: string[] = [];
    const stepResults: GateStepResult[] = [];
    let requestWritten = false;

    function writeAttribution(): Effect.Effect<void, FsError> {
      if (attributionPath === undefined || phaseId === undefined) {
        return Effect.void;
      }
      return fs.writeAtomic(
        attributionPath,
        JSON.stringify(
          encodeGateAttributionFile(
            withSchemaUrl("gate-attribution", { phase: phaseId, steps: stepResults }),
          ),
          null,
          2,
        ),
      );
    }

    /** Persist the transcript + attribution, optionally the diagnostics
     *  document, and fail the gate. Called once a step is judged to have failed;
     *  the caller has already recorded the `fail` step result. */
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
          // phax's own write under the running release, from the decoded
          // findings only: never the printed document, whose release and extra
          // keys stay in the log.
          yield* fs.writeAtomic(
            diagnosticsPathFor(attemptLogPath),
            JSON.stringify(
              encodeGateDiagnosticsFile(
                withSchemaUrl("gate-diagnostics", { diagnostics: params.document.diagnostics }),
              ),
              null,
              2,
            ),
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

      let result: ShellRunResult;
      if (step.input === "gate-request") {
        if (!requestWritten) {
          yield* fs.writeAtomic(requestPath, gateRequest);
          requestWritten = true;
        }
        logLines.push(`stdin: ${basename(requestPath)}`);
        result = yield* shell.run({ command, cwd, stdin: gateRequest });
      } else {
        result = yield* shell.run({ command, cwd });
      }

      if (result.stdout) logLines.push(result.stdout.trimEnd());
      if (result.stderr) logLines.push(result.stderr.trimEnd());
      logLines.push(`exit ${result.exitCode}`);
      logLines.push("");

      if (step.output === "diagnostics") {
        // The step promised a versioned diagnostics document on stdout. Read it
        // through the bridge; the verdict comes from the document, not the
        // exit code.
        function returnedNone(reason: string) {
          logLines.push(
            `provider error: step declared diagnostics output but returned none: ${reason}${DIAGNOSTICS_EXPECTED_SHAPE}`,
          );
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate step "${rawCommand}" declared diagnostics output but returned none: ${reason}${DIAGNOSTICS_EXPECTED_SHAPE}`,
            diagnostics: [],
            stderr: result.stderr,
          });
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(result.stdout) as unknown;
        } catch (cause) {
          return yield* returnedNone(
            `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }

        const answer = readGateDiagnosticsAnswer(parsed);
        if (Either.isLeft(answer)) {
          if (answer.left.kind === "malformed") return yield* returnedNone(answer.left.reason);
          // Every refusal names the URL phax reads: an older-shape message
          // already does; a newer one gains the expected document.
          const refusal =
            answer.left.kind === "newer"
              ? `${answer.left.message}${DIAGNOSTICS_EXPECTED_SHAPE}`
              : answer.left.message;
          logLines.push(`provider error: ${refusal}`);
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate step "${rawCommand}": ${refusal}`,
            diagnostics: [],
            stderr: result.stderr,
          });
        }

        const document = answer.right;

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

        // Every finding fails the step, invariant and completion alike, whatever
        // the exit code. The findings keep the provider's order.
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

    const decoded = readRunStatusFile(statusPath, parsed);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        gateProfileId: profileId,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(
        statusPath,
        JSON.stringify(encodeRunStatus(withSchemaUrl("run-status", updated)), null, 2),
      );
    }
  });
}
