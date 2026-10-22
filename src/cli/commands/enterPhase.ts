import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadProviderConfig } from "../../app/loadRouting.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { enterPhase } from "../../app/enterPhase.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import { Session } from "../../ports/session.js";
import { exitCodeForError, makeRepoRootedFileSystemLayer } from "./runLayers.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";

export interface EnterPhaseCommandOptions {
  newSession?: boolean;
}

export async function runEnterPhase(
  shortNameArg: string,
  phaseId: string,
  out: OutputPort,
  opts: EnterPhaseCommandOptions = {},
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  const config = Either.isRight(configResult) ? configResult.right : undefined;
  const stateRoot = effectiveStateRoot(config);

  const resolveResult = resolveRunRef(shortNameArg, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, info, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortName);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  if (!info.phaseStatuses.some((p) => p.phaseId === phaseId)) {
    out.error(`Phase "${phaseId}" not found in run "${qualifiedName}"`);
    return 1;
  }
  // Every path the use case reads is absolute, so a run of another project
  // needs no project config: the file system is then rooted at the cwd.
  const fsLayer =
    config !== undefined
      ? makeRepoRootedFileSystemLayer(config)
      : makeRootedNodeFileSystemLayer(process.cwd());

  const providerConfigResult = await Effect.runPromise(
    Effect.either(loadProviderConfig().pipe(Effect.provide(fsLayer))),
  );
  if (Either.isLeft(providerConfigResult)) {
    out.error(providerConfigResult.left.message);
    return 1;
  }
  const providerConfig = providerConfigResult.right;

  const layer = Layer.mergeAll(
    fsLayer,
    NodeGitLayer,
    makeNodeBackendLayer(providerConfig),
    makeNodeLockLayer(stateRoot),
    NoopSystemTelemetryLayer,
  );
  const planned = await Effect.runPromise(
    Effect.either(
      enterPhase({
        namespace,
        shortName,
        info,
        phaseId,
        newSession: opts.newSession === true,
        stateRoot,
        providerConfig,
      }).pipe(Effect.provide(layer)),
    ),
  );
  if (Either.isLeft(planned)) {
    out.error(planned.left.message);
    return exitCodeForError(planned.left);
  }
  const result = planned.right;
  if (result.kind === "refused") {
    out.error(result.message);
    return 1;
  }

  const { command } = result;
  out.log(result.announce);
  for (const notice of result.notices) {
    if (notice.kind === "warning") out.warn(notice.text);
    else out.log(notice.text);
  }

  const effect = Effect.gen(function* () {
    const s = yield* Session;
    return yield* s.resume({
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      env: command.env,
    });
  }).pipe(Effect.provide(makeNodeSessionLayer()));

  const spawned = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(spawned)) {
    out.error(`Failed to launch ${command.executable}: ${spawned.left.message}`);
    return 1;
  }
  return spawned.right;
}
