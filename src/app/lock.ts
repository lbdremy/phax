import { Effect } from "effect";
import type { ShortName } from "../domain/branded.js";
import { Lock } from "../ports/lock.js";
import type { FsError } from "../ports/fs.js";
import type { LockConflictError } from "../domain/errors.js";

export function withRunLock<A, E, R>(
  shortName: ShortName,
  fn: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | LockConflictError | FsError, R | Lock> {
  return Effect.gen(function* () {
    const lock = yield* Lock;
    return yield* Effect.acquireUseRelease(
      lock.acquire(shortName),
      () => fn,
      () => lock.release(shortName).pipe(Effect.ignore),
    );
  });
}
