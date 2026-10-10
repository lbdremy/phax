import { Effect, Either } from "effect";
import { basename, join } from "node:path";
import type { GateStep, ResolvedConfig } from "../schemas/phaxConfig.js";
import { GateFailedError, GateStepRefusedError } from "../domain/errors.js";
import { Shell, type ShellError, type ShellRunResult } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import {
  currentSchemaUrl,
  describeReportError,
  readGateReport,
  readRunStatusFile,
  withSchemaUrl,
  type ReportError,
} from "../schemas/persisted.js";
import type { GateFinding } from "../schemas/gateReport.js";
import { reportPathFor } from "../domain/gate/reportPath.js";
import { encodeRunStatus } from "../schemas/status.js";
import { encodeGateAttributionFile, type GateStepResult } from "../schemas/gateAttribution.js";
import { requestPathFor } from "../domain/gate/gateRequest.js";
import { encodeGateRequestFile, type GateRequest } from "../schemas/gateRequest.js";

export interface GateOutcome {
  readonly attemptLogPath: string;
}

/** A report step's stdout that is no JSON document at all, as the reader's malformed error. */
function unreadableReport(reason: string): ReportError {
  return { kind: "malformed", reads: currentSchemaUrl("gate-report"), reason };
}

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
  /** The attempt's log. A report step's readable gate report is saved beside
   *  it as `reportPathFor(attemptLogPath, <the step's 1-based position>)`. */
  readonly attemptLogPath: string;
  /** When provided together with `phaseId`, the steps that ran (up to and
   *  including the first failure or refusal) are recorded here as a
   *  GateAttribution. */
  readonly attributionPath?: string;
  readonly phaseId?: string;
  /** The phase's serialized gate request (`serializeGateRequest`). Written on
   *  the stdin of every step that declares `input: "gate-request"`, and saved
   *  beside the attempt log before the attempt's first declaring step. */
  readonly gateRequest: string;
}

export function runGates(
  opts: RunGatesOptions,
): Effect.Effect<
  GateOutcome,
  GateFailedError | GateStepRefusedError | FsError | ShellError,
  Shell | FileSystem
> {
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

    /** Persist the transcript + attribution and fail the gate. Called once a
     *  step is judged to have failed; the caller has already recorded the
     *  `fail` step result. */
    function failGate(params: {
      readonly rawCommand: string;
      readonly exitCode: number;
      readonly message: string;
      readonly reportFindings?: {
        readonly step: number;
        readonly findings: readonly GateFinding[];
      };
      readonly stderr: string;
    }): Effect.Effect<never, GateFailedError | FsError> {
      return Effect.gen(function* () {
        yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
        yield* writeAttribution();
        return yield* Effect.fail(
          new GateFailedError({
            message: params.message,
            command: params.rawCommand,
            exitCode: params.exitCode,
            logPath: attemptLogPath,
            reportFindings: params.reportFindings ?? null,
            ...(params.stderr ? { stderrExcerpt: params.stderr } : {}),
          }),
        );
      });
    }

    for (const [index, step] of steps.entries()) {
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

      const stdoutLine = logLines.length;
      if (result.stdout) logLines.push(result.stdout.trimEnd());
      if (result.stderr) logLines.push(result.stderr.trimEnd());
      logLines.push(`exit ${result.exitCode}`);
      logLines.push("");

      if (step.output === "gate-report") {
        // The step promised a gate report on stdout; the verdict comes from the
        // report. Anything else is a broken step: it fails with the raw log,
        // and nothing is saved beside it.
        function unread(error: ReportError) {
          const line = describeReportError(error);
          logLines.push(`provider error: ${line}`);
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate step "${rawCommand}": ${line}`,
            stderr: result.stderr,
          });
        }

        // A lossy decode is not the report as printed, so it is never read or saved.
        if (result.stdoutEncoding === "invalid-utf8") {
          return yield* unread(unreadableReport("stdout is not valid UTF-8"));
        }
        if (result.stdout.trim() === "") {
          return yield* unread(unreadableReport("the step printed nothing on stdout"));
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.stdout) as unknown;
        } catch (cause) {
          return yield* unread(
            unreadableReport(
              `stdout is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
          );
        }
        const read = readGateReport(parsed);
        if (Either.isLeft(read)) return yield* unread(read.left);

        // A readable report is saved first, whatever the verdict, as the step
        // printed it: never re-serialized, trimmed or re-stamped.
        const position = index + 1;
        const reportPath = reportPathFor(attemptLogPath, position);
        yield* fs.writeAtomic(reportPath, result.stdout);
        // The log names the saved report in place of its text, so that a raw-log
        // fix prompt (a later step failing) never carries the report's review
        // notes to the agent.
        logLines[stdoutLine] = `report: ${basename(reportPath)}`;

        const report = read.right;
        if (report.outcome === "refused") {
          // A refusal stops the gate for the operator, whatever the exit code:
          // no later step runs, and the fix loop makes no attempt.
          logLines.push(`refused: ${report.reason} — remedy: ${report.remedy}`);
          stepResults.push({ command: rawCommand, surface: step.surface, result: "refused" });
          yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
          yield* writeAttribution();
          return yield* Effect.fail(
            new GateStepRefusedError({
              message: `Gate step "${rawCommand}" refused to run: ${report.reason} (remedy: ${report.remedy})`,
              command: rawCommand,
              reason: report.reason,
              remedy: report.remedy,
              exitCode: result.exitCode,
              logPath: attemptLogPath,
              phaseId: phaseId ?? "",
            }),
          );
        }

        if (report.findings.length === 0) {
          // Review notes never fail a step.
          if (result.exitCode === 0) {
            stepResults.push({ command: rawCommand, surface: step.surface, result: "pass" });
            continue;
          }
          const message = `Gate step "${rawCommand}" exited ${result.exitCode} with no finding`;
          logLines.push(`provider error: ${message}`);
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message,
            stderr: result.stderr,
          });
        }

        // Any finding fails the step, whatever the exit code. The findings
        // keep the report's order.
        const count = report.findings.length;
        stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
        return yield* failGate({
          rawCommand,
          exitCode: result.exitCode,
          message: `Gate command failed: ${rawCommand} (${count === 1 ? "1 finding" : `${count} findings`})`,
          reportFindings: { step: position, findings: report.findings },
          stderr: result.stderr,
        });
      }

      if (result.exitCode !== 0) {
        stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
        return yield* failGate({
          rawCommand,
          exitCode: result.exitCode,
          message: `Gate command failed: ${rawCommand} (exit ${result.exitCode})`,
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
