import { Effect, Either } from "effect";
import { join } from "node:path";
import type { GateStep, ResolvedConfig, ScopesConfig } from "../schemas/phaxConfig.js";
import { GateFailedError, type PendingStep } from "../domain/errors.js";
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
import { diagnosticsPathFor, pendingPathFor } from "../domain/gate/diagnosticsPath.js";
import { scheduleDiagnostics, type ScopeClosure } from "../domain/gate/scheduleDiagnostics.js";
import type { ScopesRequest } from "../domain/plan/projection.js";
import { encodeGatePendingDocument, type GatePendingDocument } from "../schemas/gatePending.js";
import { queryClosedScopes } from "./scopes.js";

/**
 * Everything the runner needs, per gate attempt, to decide whether a completion
 * diagnostic is closed: whether this is the terminal phase (closes every
 * scope), the registered `scopes` provider (if any) and the plan projection
 * the provider is queried with.
 */
export interface GateScheduling {
  readonly isTerminal: boolean;
  readonly scopesProvider: ScopesConfig | undefined;
  readonly request: ScopesRequest;
}

export interface GateOutcome {
  readonly attemptLogPath: string;
  /** Pending completion diagnostics left green by this attempt; empty when none. */
  readonly pending: readonly PendingStep[];
}

const DIAGNOSTICS_EXPECTED_SHAPE =
  ' — expected {"diagnostics": [{"rule", "class": "invariant"|"completion", "scopes"?: [...], "location": {"file", "line"?}, "message", "repair"}]} on stdout';

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
  /** Terminal-ness, the registered scope provider, and the plan projection —
   *  consulted only when a diagnostic step is present. */
  readonly scheduling: GateScheduling;
}

export function runGates(
  opts: RunGatesOptions,
): Effect.Effect<GateOutcome, GateFailedError | FsError | ShellError, Shell | FileSystem> {
  const { steps, cwd, attemptLogPath, attributionPath, phaseId, scheduling } = opts;
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const logLines: string[] = [];
    const stepResults: GateStepResult[] = [];
    const pendingSteps: PendingStep[] = [];
    // Assigned once, before the step loop, and only read from the diagnostic
    // branch. `unavailable` is the harmless placeholder when no diagnostic step
    // is present (the branch that reads it never runs).
    let closure: ScopeClosure = { kind: "unavailable" };

    function writeAttribution(): Effect.Effect<void, FsError> {
      if (attributionPath === undefined || phaseId === undefined) {
        return Effect.void;
      }
      return fs.writeAtomic(
        attributionPath,
        JSON.stringify(encodeGateAttribution({ phase: phaseId, steps: stepResults }), null, 2),
      );
    }

    /** Persist the pending-diagnostics document beside the attempt log when the
     *  attempt recorded any pending completion diagnostic. */
    function writePendingDoc(): Effect.Effect<void, FsError> {
      if (pendingSteps.length === 0) {
        return Effect.void;
      }
      const closed = closure.kind === "closed" ? [...closure.closed].toSorted() : [];
      // Every entry in `pendingSteps` is pushed only when the step had at least
      // one pending diagnostic, and `scheduleDiagnostics` never yields an empty
      // `openScopes`. The non-empty-array refinement the schema encodes is thus
      // guaranteed at runtime but not expressed by `PendingStep`.
      const document = { closed, steps: pendingSteps } as unknown as GatePendingDocument;
      return fs.writeAtomic(
        pendingPathFor(attemptLogPath),
        JSON.stringify(encodeGatePendingDocument(document), null, 2),
      );
    }

    /** Persist the transcript + attribution + pending document, optionally the
     *  diagnostics document, and fail the gate. Called once a step is judged to
     *  have failed; the caller has already recorded the `fail` step result. The
     *  error carries whatever pending diagnostics the attempt accumulated. */
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
        yield* writePendingDoc();
        yield* writeAttribution();
        return yield* Effect.fail(
          new GateFailedError({
            message: params.message,
            command: params.rawCommand,
            exitCode: params.exitCode,
            logPath: attemptLogPath,
            diagnostics: params.diagnostics,
            pending: pendingSteps,
            ...(params.stderr ? { stderrExcerpt: params.stderr } : {}),
          }),
        );
      });
    }

    // Resolve scope closure once per attempt, before running any step. The
    // terminal phase closes every scope without a query; a run with no
    // diagnostic step never consults the provider; a non-terminal diagnostic
    // gate queries the registered provider (or is `unavailable` when none is
    // registered — the scheduling rule turns that into a config error).
    if (scheduling.isTerminal) {
      closure = { kind: "all" };
    } else if (steps.some((step) => step.output === "diagnostics")) {
      if (scheduling.scopesProvider === undefined) {
        closure = { kind: "unavailable" };
      } else {
        const providerCommand = scheduling.scopesProvider.command;
        const requestJson = JSON.stringify(scheduling.request);
        logLines.push(`$ ${providerCommand}`);
        logLines.push(`stdin: ${requestJson}`);
        const queried = yield* queryClosedScopes(
          scheduling.scopesProvider,
          scheduling.request,
          cwd,
        );
        if (Either.isLeft(queried)) {
          const failure = queried.left;
          const message = `Scope provider "${providerCommand}" failed: ${failure.message}`;
          logLines.push(message);
          logLines.push("");
          yield* fs.writeAtomic(attemptLogPath, logLines.join("\n"));
          yield* writeAttribution();
          return yield* Effect.fail(
            new GateFailedError({
              message,
              command: providerCommand,
              exitCode: failure.exitCode ?? 1,
              logPath: attemptLogPath,
              diagnostics: [],
              pending: [],
              ...(failure.stderrExcerpt ? { stderrExcerpt: failure.stderrExcerpt } : {}),
            }),
          );
        }
        logLines.push(JSON.stringify(queried.right));
        logLines.push("");
        closure = { kind: "closed", closed: new Set(queried.right.closed) };
      }
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
            `provider error: step declared diagnostics output but returned none: ${reason}${DIAGNOSTICS_EXPECTED_SHAPE}`,
          );
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate step "${rawCommand}" declared diagnostics output but returned none: ${reason}${DIAGNOSTICS_EXPECTED_SHAPE}`,
            diagnostics: [],
            stderr: result.stderr,
          });
        }

        const decoded = decodeGateDiagnosticsDocument(parsed);
        if (Either.isLeft(decoded)) {
          const reason = `schema mismatch: ${formatParseError(decoded.left)}`;
          logLines.push(
            `provider error: step declared diagnostics output but returned none: ${reason}${DIAGNOSTICS_EXPECTED_SHAPE}`,
          );
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate step "${rawCommand}" declared diagnostics output but returned none: ${reason}${DIAGNOSTICS_EXPECTED_SHAPE}`,
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

        // Split the document by class against the resolved closure: invariants
        // and closed completions fail the step; open completions are pending.
        const scheduled = scheduleDiagnostics(document.diagnostics, closure);

        if (scheduled.kind === "missing-provider") {
          const message = `configuration error: gate step "${rawCommand}" returned a completion diagnostic but no "scopes" provider is registered in phax.json`;
          logLines.push(message);
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message,
            diagnostics: [],
            stderr: result.stderr,
            document,
          });
        }

        if (scheduled.pending.length > 0) {
          pendingSteps.push({ command: rawCommand, pending: scheduled.pending });
        }

        if (scheduled.failing.length > 0) {
          stepResults.push({ command: rawCommand, surface: step.surface, result: "fail" });
          return yield* failGate({
            rawCommand,
            exitCode: result.exitCode,
            message: `Gate command failed: ${rawCommand} (${scheduled.failing.length} diagnostic(s))`,
            diagnostics: scheduled.failing,
            stderr: result.stderr,
            document,
          });
        }

        // Only pending diagnostics: the step does not fail the phase. Record
        // `pending` and move on; no diagnostics document is written.
        stepResults.push({ command: rawCommand, surface: step.surface, result: "pending" });
        continue;
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
    yield* writePendingDoc();
    yield* writeAttribution();
    return { attemptLogPath, pending: pendingSteps };
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
