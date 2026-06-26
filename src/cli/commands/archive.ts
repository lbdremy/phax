import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { archive } from "../../app/archive.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { makeGlobalTelemetryJournalLayer } from "../../infra/telemetry/globalJournal.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import {
  loadTelemetryConfig,
  TELEMETRY_CONFIG_PATH,
  PHAX_HOME_DIR,
} from "../../app/loadTelemetryConfig.js";

export interface ArchiveCommandOptions {
  force?: boolean;
}

function buildLayer(
  stateRoot: string,
): Layer.Layer<
  | import("../../ports/fs.js").FileSystem
  | import("../../ports/git.js").Git
  | import("../../ports/lock.js").Lock
  | import("../../ports/shell.js").Shell
  | import("../../ports/systemTelemetry.js").SystemTelemetry
> {
  const telemetryConfig = loadTelemetryConfig(TELEMETRY_CONFIG_PATH);
  const telemetryEnabled = Either.isRight(telemetryConfig) ? telemetryConfig.right.enabled : true;
  const telemetryLayer = telemetryEnabled
    ? makeGlobalTelemetryJournalLayer(PHAX_HOME_DIR).pipe(Layer.provide(NodeFileSystemLayer))
    : NoopSystemTelemetryLayer;

  return Layer.mergeAll(
    NodeFileSystemLayer,
    makeNodeGitLayer(),
    makeNodeLockLayer(stateRoot),
    NodeShellLayer,
    telemetryLayer,
  );
}

async function archiveRun(
  namespace: string,
  shortNameStr: string,
  qualifiedName: string,
  stateRoot: string,
  repoRoot: string,
  opts: ArchiveCommandOptions,
  out: OutputPort,
): Promise<number> {
  // Safe: resolveRunRef already validated the shortName.
  const shortNameResult = decodeShortName(shortNameStr);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Internal error: resolved shortName "${shortNameStr}" is invalid.`);
    return 1;
  }
  const shortName = shortNameResult.right;

  const effect = archive(namespace, shortName, stateRoot, repoRoot, opts).pipe(
    Effect.provide(buildLayer(stateRoot)),
  );

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Archive failed: ${result.left.message}`);
    return 1;
  }

  out.log(`Run "${qualifiedName}" archived successfully.`);
  return 0;
}

export async function runArchive(
  shortNameArg: string,
  opts: ArchiveCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot, repoRoot } = configResult.right;
  const config = configResult.right;

  const resolveResult = resolveRunRef(shortNameArg, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortName);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  return archiveRun(namespace, shortName, qualifiedName, stateRoot, repoRoot, opts, out);
}
