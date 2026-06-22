import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { Lock } from "../../ports/lock.js";
import { loadConfig } from "../../app/loadConfig.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";

export interface UnlockOptions {
  force?: boolean | undefined;
}

export async function runUnlock(
  runRef: string,
  opts: UnlockOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const { stateRoot } = config;

  const resolveResult = resolveRunRef(runRef, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName } = resolveResult.right;
  const qualifiedKey = runKey(namespace, shortName);

  type Outcome =
    | { action: "none" }
    | { action: "removed"; reason: "forced" | "pid_dead" | "expired" }
    | { action: "blocked"; pid: number };

  const effect = Effect.gen(function* () {
    const lock = yield* Lock;

    if (opts.force) {
      yield* lock.release(qualifiedKey);
      return { action: "removed", reason: "forced" } satisfies Outcome;
    }

    const lockStatus = yield* lock.status(qualifiedKey);
    if (lockStatus.kind === "none") {
      return { action: "none" } satisfies Outcome;
    }
    if (lockStatus.kind === "active") {
      return { action: "blocked", pid: lockStatus.pid } satisfies Outcome;
    }
    yield* lock.release(qualifiedKey);
    return { action: "removed", reason: lockStatus.reason } satisfies Outcome;
  }).pipe(Effect.provide(makeNodeLockLayer(stateRoot)));

  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    out.error(`Unlock failed: ${result.left.message}`);
    return 1;
  }

  const outcome = result.right;
  if (outcome.action === "none") {
    out.log(`No lock found for "${qualifiedKey}".`);
    return 0;
  }
  if (outcome.action === "blocked") {
    out.error(
      `Lock for "${qualifiedKey}" is held by pid ${outcome.pid}. Use --force to remove it anyway.`,
    );
    return 1;
  }
  if (outcome.reason === "forced") {
    out.log(`Lock for "${qualifiedKey}" forcibly removed.`);
  } else {
    const why = outcome.reason === "pid_dead" ? "process no longer running" : "lock expired";
    out.log(`Stale lock for "${qualifiedKey}" removed (${why}).`);
  }
  return 0;
}
