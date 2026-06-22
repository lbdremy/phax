import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { upsertRun, setRunStatus, readRegistry } from "../../src/app/registry.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { RegistryEntry } from "../../src/schemas/registry.js";

const stateRoot = "/fake-state";
const now = "2024-01-01T00:00:00.000Z";

function makeEntry(
  namespace: string,
  shortName: string,
  state: RegistryEntry["state"] = "created",
): RegistryEntry {
  return {
    namespace,
    shortName,
    runId: `${shortName}-123`,
    state,
    branch: `phax/${shortName}`,
    projectName: namespace,
    phasesCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe("upsertRun — namespace-scoped keying", () => {
  it("keeps two same-shortName runs in different namespaces as distinct rows", async () => {
    const { layer } = makeFakeFileSystem();

    await Effect.runPromise(
      Effect.all([
        upsertRun(stateRoot, makeEntry("proj-a", "fixbug")),
        upsertRun(stateRoot, makeEntry("proj-b", "fixbug")),
      ]).pipe(Effect.provide(layer)),
    );

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));

    expect(registry.runs).toHaveLength(2);
    expect(registry.runs.map((r) => r.namespace)).toEqual(["proj-a", "proj-b"]);
    expect(registry.runs.every((r) => r.shortName === "fixbug")).toBe(true);
  });

  it("updates the correct row when the same (namespace, shortName) is upserted again", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({
        version: 1,
        runs: [makeEntry("proj-a", "fixbug", "created"), makeEntry("proj-b", "fixbug", "created")],
      }),
    );

    await Effect.runPromise(
      upsertRun(stateRoot, makeEntry("proj-a", "fixbug", "running")).pipe(Effect.provide(layer)),
    );

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));

    expect(registry.runs).toHaveLength(2);
    const projA = registry.runs.find((r) => r.namespace === "proj-a");
    const projB = registry.runs.find((r) => r.namespace === "proj-b");
    expect(projA?.state).toBe("running");
    expect(projB?.state).toBe("created");
  });
});

describe("setRunStatus — namespace-scoped matching", () => {
  it("updates the correct run when two namespaces share a shortName", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({
        version: 1,
        runs: [makeEntry("proj-a", "fixbug", "running"), makeEntry("proj-b", "fixbug", "created")],
      }),
    );

    await Effect.runPromise(
      setRunStatus(stateRoot, "proj-b", "fixbug", { state: "review_open" }).pipe(
        Effect.provide(layer),
      ),
    );

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));

    const projA = registry.runs.find((r) => r.namespace === "proj-a");
    const projB = registry.runs.find((r) => r.namespace === "proj-b");
    expect(projA?.state).toBe("running");
    expect(projB?.state).toBe("review_open");
  });

  it("is a no-op when namespace does not match", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({
        version: 1,
        runs: [makeEntry("proj-a", "fixbug", "created")],
      }),
    );

    await Effect.runPromise(
      setRunStatus(stateRoot, "proj-z", "fixbug", { state: "failed" }).pipe(Effect.provide(layer)),
    );

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));
    expect(registry.runs[0]?.state).toBe("created");
  });
});
