import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { Lock } from "../../ports/lock.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { makeNodeLockLayer } from "../../infra/lock.js";

export interface UnlockOptions {
  force?: boolean | undefined;
}

export async function runUnlock(
  shortNameArg: string,
  opts: UnlockOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot } = configResult.right;

  const shortNameResult = decodeShortName(shortNameArg);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name "${shortNameArg}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
    return 1;
  }
  const shortName = shortNameResult.right;

  type Outcome =
    | { action: "none" }
    | { action: "removed"; reason: "forced" | "pid_dead" | "expired" }
    | { action: "blocked"; pid: number };

  const effect = Effect.gen(function* () {
    const lock = yield* Lock;

    if (opts.force) {
      yield* lock.release(shortName);
      return { action: "removed", reason: "forced" } satisfies Outcome;
    }

    const lockStatus = yield* lock.status(shortName);
    if (lockStatus.kind === "none") {
      return { action: "none" } satisfies Outcome;
    }
    if (lockStatus.kind === "active") {
      return { action: "blocked", pid: lockStatus.pid } satisfies Outcome;
    }
    yield* lock.release(shortName);
    return { action: "removed", reason: lockStatus.reason } satisfies Outcome;
  }).pipe(Effect.provide(makeNodeLockLayer(stateRoot)));

  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    out.error(`Unlock failed: ${result.left.message}`);
    return 1;
  }

  const outcome = result.right;
  if (outcome.action === "none") {
    out.log(`No lock found for "${shortName}".`);
    return 0;
  }
  if (outcome.action === "blocked") {
    out.error(
      `Lock for "${shortName}" is held by pid ${outcome.pid}. Use --force to remove it anyway.`,
    );
    return 1;
  }
  if (outcome.reason === "forced") {
    out.log(`Lock for "${shortName}" forcibly removed.`);
  } else {
    const why = outcome.reason === "pid_dead" ? "process no longer running" : "lock expired";
    out.log(`Stale lock for "${shortName}" removed (${why}).`);
  }
  return 0;
}
