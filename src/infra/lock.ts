import { Effect, Either, Layer } from "effect";
import { open as nodeOpen, readFile, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { Lock, decodeLockFile, type LockFile, type LockStatus } from "../ports/lock.js";
import { LockConflictError } from "../domain/errors.js";
import { FsError } from "../ports/fs.js";

const DEFAULT_STALE_THRESHOLD_MS = 30 * 60 * 1000;

function lockFilePath(stateRoot: string, key: string): string {
  return join(stateRoot, "locks", `${key}.lock`);
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function wrapFsError(err: unknown): FsError {
  return new FsError({
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}

async function readLockFile(path: string): Promise<LockFile | undefined> {
  try {
    const content = await readFile(path, "utf8");
    const decoded = decodeLockFile(JSON.parse(content) as unknown);
    return Either.isRight(decoded) ? decoded.right : undefined;
  } catch {
    return undefined;
  }
}

async function writeLockFile(path: string, data: LockFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await nodeOpen(path, "wx");
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function classifyLock(lock: LockFile, staleThresholdMs: number): LockStatus {
  if (!isPidRunning(lock.pid)) {
    return { kind: "stale", pid: lock.pid, reason: "pid_dead" };
  }
  const age = Date.now() - new Date(lock.updatedAt).getTime();
  if (age > staleThresholdMs) {
    return { kind: "stale", pid: lock.pid, reason: "expired" };
  }
  return { kind: "active", pid: lock.pid, updatedAt: lock.updatedAt };
}

export function makeNodeLockLayer(
  stateRoot: string,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): Layer.Layer<Lock> {
  return Layer.succeed(Lock, {
    acquire: (key) => {
      const path = lockFilePath(stateRoot, key);
      return Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(path), { recursive: true });
          const newLock: LockFile = {
            runKey: key,
            pid: process.pid,
            status: "active",
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          try {
            await writeLockFile(path, newLock);
          } catch (openErr) {
            const code = (openErr as NodeJS.ErrnoException).code;
            if (code !== "EEXIST") throw openErr;

            const existing = await readLockFile(path);
            if (!existing) {
              throw new LockConflictError({
                message: `Run "${key}" is locked (unreadable lock file)`,
                shortName: key,
                lockPath: path,
                lockingPid: -1,
              });
            }

            const lockStatus = classifyLock(existing, staleThresholdMs);
            if (lockStatus.kind === "active") {
              throw new LockConflictError({
                message: `Run "${key}" is locked by pid ${existing.pid}`,
                shortName: key,
                lockPath: path,
                lockingPid: existing.pid,
              });
            }

            // Stale lock — remove and retry once
            await rm(path, { force: true });
            try {
              await writeLockFile(path, newLock);
            } catch (retryErr) {
              const retryCode = (retryErr as NodeJS.ErrnoException).code;
              if (retryCode === "EEXIST") {
                throw new LockConflictError({
                  message: `Run "${key}" was locked by another process during stale-lock cleanup`,
                  shortName: key,
                  lockPath: path,
                  lockingPid: -1,
                });
              }
              throw retryErr;
            }
          }
        },
        catch: (err): LockConflictError | FsError => {
          if (err instanceof LockConflictError) return err;
          return wrapFsError(err);
        },
      });
    },

    renew: (key) => {
      const path = lockFilePath(stateRoot, key);
      return Effect.tryPromise({
        try: async () => {
          const existing = await readLockFile(path);
          if (existing) {
            const updated: LockFile = { ...existing, updatedAt: nowIso() };
            await (await nodeOpen(path, "w")).writeFile(JSON.stringify(updated, null, 2), "utf8");
          }
        },
        catch: wrapFsError,
      });
    },

    release: (key) => {
      const path = lockFilePath(stateRoot, key);
      return Effect.tryPromise({
        try: () => rm(path, { force: true }),
        catch: wrapFsError,
      });
    },

    status: (key) => {
      const path = lockFilePath(stateRoot, key);
      return Effect.tryPromise({
        try: async (): Promise<LockStatus> => {
          const existing = await readLockFile(path);
          if (!existing) return { kind: "none" };
          return classifyLock(existing, staleThresholdMs);
        },
        catch: wrapFsError,
      });
    },
  });
}
