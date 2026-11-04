// `phax unlock <short-name>` as the runner reads it: remove a run's lock when its holder is gone
// or it expired, or whatever its state with `--force`. The answer names the run and what was
// removed (`stale`: the holder's process is gone, `expired`: the lock outlived its lifetime,
// `forced`, or `none`: there was no lock); the text is a view of that answer. A lock held by a
// live process is a declared error, as is a configuration that does not load.
import { Data, Effect, Either } from "effect";
import * as Schema from "effect/Schema";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { Lock } from "../../ports/lock.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import { configured, exposeMessage, MessageFields, ShortNameArg } from "./shared.js";

/** The configuration did not load. */
class UnlockConfigError extends Data.TaggedError("UnlockConfigError")<{
  readonly message: string;
}> {}

/** The run reference was refused: the resolver's sentence. */
class UnlockRunRefError extends Data.TaggedError("UnlockRunRefError")<{
  readonly message: string;
}> {}

/** The lock could not be read or released. */
class UnlockFailedError extends Data.TaggedError("UnlockFailedError")<{
  readonly message: string;
}> {}

/** A live process holds the lock. */
class LockHeldError extends Data.TaggedError("LockHeldError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly pid: number;
}> {}

const UnlockOutput = Schema.Struct({
  shortName: Schema.String,
  removed: Schema.Literal("stale", "expired", "forced", "none"),
  qualifiedName: Schema.String,
});

type UnlockOutput = typeof UnlockOutput.Type;

/** Today's sentence for an answer. */
function unlockSentence(value: UnlockOutput): string {
  switch (value.removed) {
    case "none":
      return `No lock found for "${value.qualifiedName}".`;
    case "forced":
      return `Lock for "${value.qualifiedName}" forcibly removed.`;
    case "stale":
      return `Stale lock for "${value.qualifiedName}" removed (process no longer running).`;
    case "expired":
      return `Stale lock for "${value.qualifiedName}" removed (lock expired).`;
  }
}

export const unlockCommand = defineCommand({
  name: "unlock",
  summary: "Remove a stale run lock; use --force to remove any lock",
  input: {
    args: reject(Schema.Tuple(ShortNameArg)),
    flags: reject(
      Schema.Struct({
        force: Schema.optionalWith(
          Schema.Boolean.annotations({ description: "Remove the lock regardless of staleness" }),
          { exact: true },
        ),
      }),
    ),
  },
  output: reject(UnlockOutput),
  run: ({ input }) =>
    Effect.gen(function* () {
      const config = yield* configured().pipe(
        Effect.mapError(
          (error) => new UnlockConfigError({ message: `Config error: ${error.message}` }),
        ),
      );
      const resolved = resolveRunRef(input.args[0], config, config.stateRoot);
      if (Either.isLeft(resolved)) {
        return yield* Effect.fail(new UnlockRunRefError({ message: resolved.left.message }));
      }
      const { namespace, shortName } = resolved.right;
      const qualifiedName = runKey(namespace, shortName);
      const removing = (removed: UnlockOutput["removed"]): UnlockOutput => ({
        shortName,
        removed,
        qualifiedName,
      });

      return yield* Effect.gen(function* () {
        const lock = yield* Lock;
        if (input.flags.force === true) {
          yield* lock.release(qualifiedName);
          return removing("forced");
        }
        const status = yield* lock.status(qualifiedName);
        if (status.kind === "none") return removing("none");
        if (status.kind === "active") {
          return yield* Effect.fail(
            new LockHeldError({
              message: `Lock for "${qualifiedName}" is held by pid ${status.pid}. Use --force to remove it anyway.`,
              qualifiedName,
              pid: status.pid,
            }),
          );
        }
        yield* lock.release(qualifiedName);
        return removing(status.reason === "pid_dead" ? "stale" : "expired");
      }).pipe(
        Effect.provide(makeNodeLockLayer(config.stateRoot)),
        Effect.catchIf(
          (error) => !(error instanceof LockHeldError),
          (error) =>
            Effect.fail(new UnlockFailedError({ message: `Unlock failed: ${error.message}` })),
        ),
      );
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { UnlockConfigError: 1, UnlockRunRefError: 1, UnlockFailedError: 1, LockHeldError: 1 },
  errors: {
    UnlockConfigError: MessageFields,
    UnlockRunRefError: MessageFields,
    UnlockFailedError: MessageFields,
    LockHeldError: Schema.Struct({
      message: Schema.String,
      qualifiedName: Schema.String,
      pid: Schema.Number,
    }),
  },
  texts: {
    UnlockConfigError: (error) => error.message,
    UnlockRunRefError: (error) => error.message,
    UnlockFailedError: (error) => error.message,
    LockHeldError: (error) => error.message,
  },
  render: unlockSentence,
});
