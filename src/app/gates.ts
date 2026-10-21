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
import { stepRecordPathFor } from "../domain/gate/attemptFiles.js";
import { commandWords } from "../domain/gate/commandWords.js";
import { encodeGateRequestFile, type GateRequest } from "../schemas/gateRequest.js";
import { encodeOracleRequestFile, type OracleRequest } from "../schemas/oracleRequest.js";
import { oracleRequestPathFor } from "../domain/gate/oracleRequest.js";
import type { RecordedSurface } from "../schemas/surface.js";

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

/** The oracles provider's wall-clock cap. Fixed: the `oracles` block holds only `command`. */
export const ORACLE_PROVIDER_TIMEOUT_MS = 120_000;

/**
 * The exact bytes of an oracle request: what the oracles provider reads on
 * stdin and what is saved as `checks-attempt-NN.oracle-request.json`. Stamped
 * with oracle-request's current stamp, two-space indented, no trailing newline.
 */
export function serializeOracleRequest(request: OracleRequest): string {
  return JSON.stringify(encodeOracleRequestFile(withSchemaUrl("oracle-request", request)), null, 2);
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
  const parts = commandWords(raw);
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
  /** When provided, the attempt's step record (the same GateAttribution) is
   *  also saved beside its log as `stepRecordPathFor(attemptLogPath)`. */
  readonly phaseId?: string;
  /** The phase's serialized gate request (`serializeGateRequest`). Written on
   *  the stdin of every step that declares `input: "gate-request"`, and saved
   *  beside the attempt log before the attempt's first declaring step. */
  readonly gateRequest: string;
  /** The oracle step, set exactly when the phase is an oracle phase or the
   *  phase that discharges one. Run once every configured step has passed,
   *  last, under the `oracle` surface: `command` is split on whitespace (no
   *  shell), `request` is written on its stdin and saved beside the log as
   *  `oracleRequestPathFor(attemptLogPath)`, and `timeoutMs` caps it. */
  readonly oracleStep?: OracleStep;
}

/** The oracle step's command, its serialized request and its time cap. */
export interface OracleStep {
  readonly command: string;
  readonly request: string;
  readonly timeoutMs: number;
}

export function runGates(
  opts: RunGatesOptions,
): Effect.Effect<
  GateOutcome,
  GateFailedError | GateStepRefusedError | FsError | ShellError,
  Shell | FileSystem
> {
  const { steps, cwd, attemptLogPath, attributionPath, phaseId, gateRequest, oracleStep } = opts;
  const requestPath = requestPathFor(attemptLogPath);
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const logLines: string[] = [];
    const stepResults: GateStepResult[] = [];
    let requestWritten = false;

    /** Writes the attempt's step record beside its log and, when asked, the
     *  phase's `gate-attribution.json`: one document, the steps that ran. */
    function writeAttribution(): Effect.Effect<void, FsError> {
      return Effect.gen(function* () {
        if (phaseId === undefined) return;
        const document = JSON.stringify(
          encodeGateAttributionFile(
            withSchemaUrl("gate-attribution", { phase: phaseId, steps: stepResults }),
          ),
          null,
          2,
        );
        yield* fs.writeAtomic(stepRecordPathFor(attemptLogPath), document);
        if (attributionPath !== undefined) yield* fs.writeAtomic(attributionPath, document);
      });
    }

    /** Persist the transcript + attribution and fail the gate. Called once a
     *  step is judged to have failed; the caller has already recorded the
     *  `fail` step result. */
    function failGate(params: {
      readonly rawCommand: string;
      readonly surface: RecordedSurface;
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
            failedStep: params.surface === "oracle" ? "oracle" : "configured",
            ...(params.stderr ? { stderrExcerpt: params.stderr } : {}),
          }),
        );
      });
    }

    /**
     * Judges a report step's result, a configured `output: "gate-report"` step
     * and the oracle step alike, and records it. Succeeds only when the step
     * passed; any other verdict fails the gate.
     */
    function judgeReport(params: {
      readonly rawCommand: string;
      readonly surface: RecordedSurface;
      readonly position: number;
      readonly result: ShellRunResult;
      readonly stdoutLine: number;
    }): Effect.Effect<void, GateFailedError | GateStepRefusedError | FsError> {
      const { rawCommand, surface, position, result, stdoutLine } = params;
      return Effect.gen(function* () {
        // The step promised a gate report on stdout; the verdict comes from the
        // report. Anything else is a broken step: it fails with the raw log,
        // and nothing is saved beside it.
        function unread(error: ReportError) {
          const line = describeReportError(error);
          logLines.push(`provider error: ${line}`);
          stepResults.push({ command: rawCommand, surface, result: "fail" });
          return failGate({
            rawCommand,
            surface,
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
          stepResults.push({ command: rawCommand, surface, result: "refused" });
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
            stepResults.push({ command: rawCommand, surface, result: "pass" });
            return;
          }
          const message = `Gate step "${rawCommand}" exited ${result.exitCode} with no finding`;
          logLines.push(`provider error: ${message}`);
          stepResults.push({ command: rawCommand, surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            surface,
            exitCode: result.exitCode,
            message,
            stderr: result.stderr,
          });
        }

        // Any finding fails the step, whatever the exit code. The findings
        // keep the report's order.
        const count = report.findings.length;
        stepResults.push({ command: rawCommand, surface, result: "fail" });
        return yield* failGate({
          rawCommand,
          surface,
          exitCode: result.exitCode,
          message: `Gate command failed: ${rawCommand} (${count === 1 ? "1 finding" : `${count} findings`})`,
          reportFindings: { step: position, findings: report.findings },
          stderr: result.stderr,
        });
      });
    }

    /** Logs a step's output and exit; returns the index of its stdout line. */
    function logResult(result: ShellRunResult): number {
      const stdoutLine = logLines.length;
      if (result.stdout) logLines.push(result.stdout.trimEnd());
      if (result.stderr) logLines.push(result.stderr.trimEnd());
      logLines.push(`exit ${result.exitCode}`);
      logLines.push("");
      return stdoutLine;
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

      const stdoutLine = logResult(result);

      if (step.output === "gate-report") {
        yield* judgeReport({
          rawCommand,
          surface: step.surface,
          position: index + 1,
          result,
          stdoutLine,
        });
        continue;
      }

      if (result.exitCode !== 0) {
        stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
        return yield* failGate({
          rawCommand,
          surface: step.surface,
          exitCode: result.exitCode,
          message: `Gate command failed: ${rawCommand} (exit ${result.exitCode})`,
          stderr: result.stderr,
        });
      }

      stepResults.push({ command: rawCommand, surface: step.surface, result: "pass" });
    }

    if (oracleStep !== undefined) {
      // Every configured step passed: phax appends the oracle step, last. Its
      // request is saved beside the log before the provider reads it.
      const rawCommand = oracleStep.command;
      const oracleRequestPath = oracleRequestPathFor(attemptLogPath);
      yield* fs.writeAtomic(oracleRequestPath, oracleStep.request);
      logLines.push(`$ ${rawCommand}`);
      logLines.push(`stdin: ${basename(oracleRequestPath)}`);
      const spawned = yield* Effect.either(
        shell.run({
          command: parseCommandTokens(rawCommand),
          cwd,
          stdin: oracleStep.request,
          timeoutMs: oracleStep.timeoutMs,
        }),
      );
      if (Either.isLeft(spawned)) {
        // The provider could not be spawned or outran the cap: there is no
        // report to judge, so the step is broken.
        const error = spawned.left;
        logLines.push(`provider error: ${error.message}`);
        logLines.push("");
        stepResults.push({ command: rawCommand, surface: "oracle", result: "fail" });
        return yield* failGate({
          rawCommand,
          surface: "oracle",
          exitCode: error.exitCode ?? -1,
          message: `Gate step "${rawCommand}": ${error.message}`,
          stderr: error.stderrExcerpt ?? "",
        });
      }
      const result = spawned.right;
      yield* judgeReport({
        rawCommand,
        surface: "oracle",
        position: steps.length + 1,
        result,
        stdoutLine: logResult(result),
      });
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
