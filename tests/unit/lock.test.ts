import { describe, it, expect, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { runKey } from "../../src/domain/runRef.js";

describe("Lock – qualified-key scoping", () => {
  let fakeLock: ReturnType<typeof makeFakeLock>;

  beforeEach(() => {
    fakeLock = makeFakeLock();
  });

  it("acquire/status/release operate on the qualified key", async () => {
    const key = runKey("myproject", "fixbug");

    const statusBefore = await Effect.runPromise(fakeLock.impl.status(key));
    expect(statusBefore.kind).toBe("none");

    await Effect.runPromise(fakeLock.impl.acquire(key));

    const statusAfter = await Effect.runPromise(fakeLock.impl.status(key));
    expect(statusAfter.kind).toBe("active");

    await Effect.runPromise(fakeLock.impl.release(key));

    const statusFinal = await Effect.runPromise(fakeLock.impl.status(key));
    expect(statusFinal.kind).toBe("none");
  });

  it("two runs with the same short name in different namespaces hold independent locks", async () => {
    const keyA = runKey("projecta", "fixbug");
    const keyB = runKey("projectb", "fixbug");

    await Effect.runPromise(fakeLock.impl.acquire(keyA));

    // keyA is active but keyB should be independent
    const statusA = await Effect.runPromise(fakeLock.impl.status(keyA));
    const statusB = await Effect.runPromise(fakeLock.impl.status(keyB));

    expect(statusA.kind).toBe("active");
    expect(statusB.kind).toBe("none");

    // acquiring keyB should succeed despite keyA being locked
    await Effect.runPromise(fakeLock.impl.acquire(keyB));

    const statusBAfter = await Effect.runPromise(fakeLock.impl.status(keyB));
    expect(statusBAfter.kind).toBe("active");
  });

  it("acquiring an already-active lock fails with LockConflictError", async () => {
    const key = runKey("myproject", "fixbug");

    await Effect.runPromise(fakeLock.impl.acquire(key));

    const result = await Effect.runPromise(Effect.either(fakeLock.impl.acquire(key)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("is locked");
    }
  });

  it("lock file records the qualified key", async () => {
    // Verify via setStatus that the map key is the qualified key string
    const key = runKey("myproject", "fixbug");
    fakeLock.impl.setStatus(key, {
      kind: "active",
      pid: 1234,
      updatedAt: "2024-01-01T00:00:00.000Z",
    });

    const status = await Effect.runPromise(fakeLock.impl.status(key));
    expect(status.kind).toBe("active");
    if (status.kind === "active") {
      expect(status.pid).toBe(1234);
    }

    // The bare short name should not be affected
    const bareStatus = await Effect.runPromise(fakeLock.impl.status("fixbug"));
    expect(bareStatus.kind).toBe("none");
  });
});
