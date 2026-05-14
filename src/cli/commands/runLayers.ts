import { Effect } from "effect";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import { Git } from "../../ports/git.js";
import { Lock } from "../../ports/lock.js";
import { Shell } from "../../ports/shell.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  ClaudeInvocationError,
  ClaudeSessionIdMissingError,
  ConfigValidationError,
  GateFailedError,
  LockConflictError,
  PlanValidationError,
  RegistryCorruptionError,
  UnsafeGitStateError,
} from "../../domain/errors.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";

export function provideRunLayers<A, E>(
  effect: Effect.Effect<A, E, Backend | FileSystem | Git | Shell | Lock>,
  config: ResolvedConfig,
): Effect.Effect<A, E, never> {
  return effect.pipe(
    Effect.provide(makeNodeBackendLayer()),
    Effect.provide(NodeFileSystemLayer),
    Effect.provide(NodeGitLayer),
    Effect.provide(NodeShellLayer),
    Effect.provide(makeNodeLockLayer(config.stateRoot)),
  );
}

export function exitCodeForError(err: unknown): number {
  if (err instanceof PlanValidationError || err instanceof ConfigValidationError) return 2;
  if (err instanceof UnsafeGitStateError) return 3;
  if (err instanceof GateFailedError) return 4;
  if (err instanceof ClaudeInvocationError || err instanceof ClaudeSessionIdMissingError) return 5;
  if (err instanceof ArchiveBlockedByDirtyWorktreeError) return 6;
  if (err instanceof LockConflictError) return 7;
  if (err instanceof RegistryCorruptionError) return 10;
  return 1;
}
