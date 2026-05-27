import { Effect, type Layer } from "effect";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { NodeShellLayer } from "../../infra/shell.js";
import {
  NoopTracerLayer,
  makeTraceTracerLayer,
  makeVerboseTracerLayer,
} from "../../infra/tracer.js";
import { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import { Git } from "../../ports/git.js";
import { Lock } from "../../ports/lock.js";
import { Shell } from "../../ports/shell.js";
import type { OutputPort } from "../../ports/output.js";
import { Tracer } from "../../ports/tracer.js";
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
  effect: Effect.Effect<A, E, Backend | FileSystem | Git | Shell | Lock | Tracer>,
  config: ResolvedConfig,
  tracerLayer: Layer.Layer<Tracer>,
): Effect.Effect<A, E, never> {
  return effect.pipe(
    Effect.provide(makeNodeBackendLayer()),
    Effect.provide(NodeFileSystemLayer),
    Effect.provide(NodeGitLayer),
    Effect.provide(NodeShellLayer),
    Effect.provide(makeNodeLockLayer(config.stateRoot)),
    Effect.provide(tracerLayer),
  );
}

/**
 * Build the tracer layer for a command from its `--verbose` / `--trace` flags.
 * `--trace` writes JSONL to `traceJsonlPath` (and also renders verbosely when
 * both flags are set); `--verbose` alone renders to the OutputPort; neither
 * yields the no-op tracer.
 */
export function buildTracerLayer(
  opts: { verbose?: boolean | undefined; trace?: boolean | undefined },
  traceJsonlPath: string,
  out: OutputPort,
): Layer.Layer<Tracer> {
  if (opts.trace === true) {
    return makeTraceTracerLayer(traceJsonlPath, out, opts.verbose === true);
  }
  if (opts.verbose === true) {
    return makeVerboseTracerLayer(out);
  }
  return NoopTracerLayer;
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
