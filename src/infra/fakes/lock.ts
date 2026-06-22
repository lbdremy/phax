import { Effect, Layer } from "effect";
import { LockConflictError } from "../../domain/errors.js";
import { Lock, type LockOps, type LockStatus } from "../../ports/lock.js";

export class FakeLockImpl implements LockOps {
  readonly statuses = new Map<string, LockStatus>();

  setStatus(key: string, status: LockStatus): void {
    this.statuses.set(key, status);
  }

  acquire(key: string): Effect.Effect<void, LockConflictError> {
    const current = this.statuses.get(key) ?? { kind: "none" };
    if (current.kind === "active") {
      return Effect.fail(
        new LockConflictError({
          message: `Run "${key}" is locked by pid ${current.pid}`,
          shortName: key,
          lockPath: `/fake/locks/${key}.lock`,
          lockingPid: current.pid,
        }),
      );
    }
    this.statuses.set(key, {
      kind: "active",
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    });
    return Effect.void;
  }

  renew(_key: string): Effect.Effect<void> {
    return Effect.void;
  }

  release(key: string): Effect.Effect<void> {
    this.statuses.set(key, { kind: "none" });
    return Effect.void;
  }

  status(key: string): Effect.Effect<LockStatus> {
    return Effect.succeed(this.statuses.get(key) ?? { kind: "none" });
  }
}

export const makeFakeLock = () => {
  const impl = new FakeLockImpl();
  const layer = Layer.succeed(Lock, impl);
  return { impl, layer } as const;
};
