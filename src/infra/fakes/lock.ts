import { Effect, Layer } from "effect";
import type { ShortName } from "../../domain/branded.js";
import { LockConflictError } from "../../domain/errors.js";
import { Lock, type LockOps, type LockStatus } from "../../ports/lock.js";

export class FakeLockImpl implements LockOps {
  readonly statuses = new Map<string, LockStatus>();

  setStatus(shortName: string, status: LockStatus): void {
    this.statuses.set(shortName, status);
  }

  acquire(shortName: ShortName): Effect.Effect<void, LockConflictError> {
    const current = this.statuses.get(shortName) ?? { kind: "none" };
    if (current.kind === "active") {
      return Effect.fail(
        new LockConflictError({
          message: `Run "${shortName}" is locked by pid ${current.pid}`,
          shortName,
          lockPath: `/fake/locks/${shortName}.lock`,
          lockingPid: current.pid,
        }),
      );
    }
    this.statuses.set(shortName, {
      kind: "active",
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    });
    return Effect.void;
  }

  renew(_shortName: ShortName): Effect.Effect<void> {
    return Effect.void;
  }

  release(shortName: ShortName): Effect.Effect<void> {
    this.statuses.set(shortName, { kind: "none" });
    return Effect.void;
  }

  status(shortName: ShortName): Effect.Effect<LockStatus> {
    return Effect.succeed(this.statuses.get(shortName) ?? { kind: "none" });
  }
}

export const makeFakeLock = () => {
  const impl = new FakeLockImpl();
  const layer = Layer.succeed(Lock, impl);
  return { impl, layer } as const;
};
