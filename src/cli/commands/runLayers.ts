import { Effect, Layer } from "effect";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { NodeShellLayer } from "../../infra/shell.js";
import {
  makeSystemTelemetryLayer,
  type TelemetryFactoryInput,
} from "../../infra/telemetry/layer.js";
import { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import { Git } from "../../ports/git.js";
import { Lock } from "../../ports/lock.js";
import { Shell } from "../../ports/shell.js";
import type { OutputPort } from "../../ports/output.js";
import { SystemTelemetry } from "../../ports/systemTelemetry.js";
import type { RunId } from "../../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  ConfigValidationError,
  GateFailedError,
  LockConflictError,
  PhaseHadNoChangesError,
  PlanValidationError,
  RateLimitError,
  RegistryCorruptionError,
  UnsafeGitStateError,
  UsageLimitError,
} from "../../domain/errors.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";

export function provideRunLayers<A, E>(
  effect: Effect.Effect<A, E, Backend | FileSystem | Git | Shell | Lock | SystemTelemetry>,
  config: ResolvedConfig,
  systemTelemetryLayer: Layer.Layer<SystemTelemetry>,
): Effect.Effect<A, E, never> {
  return effect.pipe(
    Effect.provide(makeNodeBackendLayer()),
    Effect.provide(NodeFileSystemLayer),
    Effect.provide(NodeGitLayer),
    Effect.provide(NodeShellLayer),
    Effect.provide(makeNodeLockLayer(config.stateRoot)),
    Effect.provide(systemTelemetryLayer),
  );
}

/**
 * Build a SystemTelemetry layer from CLI flags and env vars.
 * Provides its own NodeFileSystemLayer internally so the result is self-contained.
 */
export function buildSystemTelemetryLayer(
  opts: { verbose?: boolean | undefined; trace?: boolean | undefined },
  tracePath: string,
  out: OutputPort,
  runId: RunId,
): Layer.Layer<SystemTelemetry> {
  const input: TelemetryFactoryInput = {
    output: out,
    verbose: opts.verbose === true,
    ...(opts.trace === true ? { tracePath } : {}),
    otelEnabled: process.env["PHAX_OTEL"] === "1",
    runId,
  };
  return makeSystemTelemetryLayer(input).pipe(Layer.provide(NodeFileSystemLayer));
}

export function exitCodeForError(err: unknown): number {
  if (err instanceof PlanValidationError || err instanceof ConfigValidationError) return 2;
  if (err instanceof UnsafeGitStateError) return 3;
  if (err instanceof GateFailedError) return 4;
  if (err instanceof ClaudeInvocationError || err instanceof ClaudeSessionIdMissingError) return 5;
  if (err instanceof ArchiveBlockedByDirtyWorktreeError) return 6;
  if (err instanceof LockConflictError) return 7;
  if (err instanceof RateLimitError || err instanceof UsageLimitError) return 8;
  if (err instanceof PhaseHadNoChangesError) return 9;
  if (err instanceof RegistryCorruptionError) return 10;
  return 1;
}
