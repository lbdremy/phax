import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { makeGlobalTelemetryJournalLayer } from "../../infra/telemetry/globalJournal.js";
import {
  makeSystemTelemetryLayer,
  type TelemetryFactoryInput,
} from "../../infra/telemetry/layer.js";
import { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import { Git } from "../../ports/git.js";
import { GitHub } from "../../ports/github.js";
import { Lock } from "../../ports/lock.js";
import { Shell } from "../../ports/shell.js";
import type { OutputPort } from "../../ports/output.js";
import { NoopSystemTelemetryLayer, SystemTelemetry } from "../../ports/systemTelemetry.js";
import {
  loadTelemetryConfig,
  TELEMETRY_CONFIG_PATH,
  PHAX_HOME_DIR,
} from "../../app/loadTelemetryConfig.js";
import type { RunId } from "../../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  AgentInvocationError,
  AgentSessionIdMissingError,
  ArtifactDirtyWriteSetError,
  ArtifactValidationError,
  ConfigValidationError,
  GateFailedError,
  InvalidArtifactTransitionError,
  LockConflictError,
  ModelPreflightError,
  PhaseHadNoChangesError,
  PlanNotApprovedError,
  PlanStaleError,
  PlanValidationError,
  RateLimitError,
  RecordsSyncRequiredError,
  RegistryCorruptionError,
  SecurityEnforcementError,
  SecurityPreflightError,
  SpecNotApprovedError,
  SpecRetirementBlockedError,
  UnsafeGitStateError,
  UsageLimitError,
} from "../../domain/errors.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";

/**
 * Turn a resolved config into the repo-rooted `FileSystem` layer every command
 * with a config must use. Relative paths crossing the port (`docs/plans`,
 * `docs/plans/approvals.json`) then resolve against `config.repoRoot` — matching
 * git's own work-from-anywhere contract — while absolute paths (`stateRoot`,
 * `PHAX_HOME_DIR`) pass through unchanged. The architectural guard in
 * `tests/unit/architecturalGuards.test.ts` forbids a command from reaching for
 * the identity `NodeFileSystemLayer` instead of this helper.
 */
export function makeRepoRootedFileSystemLayer(config: ResolvedConfig): Layer.Layer<FileSystem> {
  return makeRootedNodeFileSystemLayer(config.repoRoot);
}

/**
 * The global telemetry journal (or a no-op when telemetry is disabled), fully
 * provided with its own filesystem. The journal writes under `PHAX_HOME_DIR`,
 * which is absolute, so it is deliberately backed by the identity
 * `NodeFileSystemLayer` rather than a repo-rooted view — encapsulated here so
 * commands never reach for the identity layer directly.
 */
export function makeGlobalTelemetryJournalLayerOrNoop(): Layer.Layer<SystemTelemetry> {
  const telemetryConfig = loadTelemetryConfig(TELEMETRY_CONFIG_PATH);
  const telemetryEnabled = Either.isRight(telemetryConfig) ? telemetryConfig.right.enabled : true;
  return telemetryEnabled
    ? makeGlobalTelemetryJournalLayer(PHAX_HOME_DIR).pipe(Layer.provide(NodeFileSystemLayer))
    : NoopSystemTelemetryLayer;
}

export function provideRunLayers<A, E>(
  effect: Effect.Effect<A, E, Backend | FileSystem | Git | GitHub | Shell | Lock | SystemTelemetry>,
  config: ResolvedConfig,
  systemTelemetryLayer: Layer.Layer<SystemTelemetry>,
  providerConfig: ProviderConfig,
): Effect.Effect<A, E, never> {
  return effect.pipe(
    Effect.provide(makeNodeBackendLayer(providerConfig)),
    Effect.provide(makeRepoRootedFileSystemLayer(config)),
    Effect.provide(NodeGitLayer),
    Effect.provide(NodeGitHubLayer),
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
    runId,
  };
  return makeSystemTelemetryLayer(input).pipe(Layer.provide(NodeFileSystemLayer));
}

export function exitCodeForError(err: unknown): number {
  if (err instanceof PlanValidationError || err instanceof ConfigValidationError) return 2;
  if (err instanceof UnsafeGitStateError) return 3;
  if (err instanceof GateFailedError) return 4;
  if (err instanceof AgentInvocationError || err instanceof AgentSessionIdMissingError) return 5;
  if (err instanceof ArchiveBlockedByDirtyWorktreeError) return 6;
  if (err instanceof LockConflictError) return 7;
  if (err instanceof RateLimitError || err instanceof UsageLimitError) return 8;
  if (err instanceof PhaseHadNoChangesError) return 9;
  if (err instanceof RegistryCorruptionError) return 10;
  if (
    err instanceof SecurityEnforcementError ||
    err instanceof SecurityPreflightError ||
    err instanceof ModelPreflightError ||
    err instanceof RecordsSyncRequiredError
  )
    return 11;
  if (
    err instanceof InvalidArtifactTransitionError ||
    err instanceof ArtifactValidationError ||
    err instanceof PlanNotApprovedError ||
    err instanceof SpecNotApprovedError ||
    err instanceof SpecRetirementBlockedError ||
    err instanceof PlanStaleError ||
    err instanceof ArtifactDirtyWriteSetError
  )
    return 12;
  return 1;
}

export function renderAgentInvocationError(err: AgentInvocationError): {
  message: string;
  logHint: string | undefined;
} {
  const raw = err.stderrExcerpt ?? err.stderr;
  const bounded = raw ? raw.slice(-500).trim() : undefined;
  const message = bounded ? `${err.message}: ${bounded}` : err.message;
  const logHint =
    err.phaseFolderPath !== undefined
      ? `See ${join(err.phaseFolderPath, "agent-error.log")} for the full agent output.`
      : undefined;
  return { message, logHint };
}
