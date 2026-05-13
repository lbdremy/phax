import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { readRegistry, upsertRun, setRunStatus } from "../../src/app/registry.js";
import { RegistryCorruptionError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { RegistryEntry } from "../../src/schemas/registry.js";

const stateRoot = "/fake-state";

const makeEntry = (shortName: string, overrides?: Partial<RegistryEntry>): RegistryEntry => ({
  shortName,
  runId: `${shortName}-123`,
  state: "created",
  branch: "feature/run",
  projectName: "test-project",
  phasesCount: 3,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("readRegistry", () => {
  it("returns an empty registry when the registry file does not exist", async () => {
    const { layer } = makeFakeFileSystem();
    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));
    expect(registry.version).toBe(1);
    expect(registry.runs).toHaveLength(0);
  });

  it("reads and decodes an existing registry", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({
        version: 1,
        runs: [makeEntry("my-run")],
      }),
    );

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));
    expect(registry.runs).toHaveLength(1);
    expect(registry.runs[0]?.shortName).toBe("my-run");
  });

  it("fails with RegistryCorruptionError on invalid JSON", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(`${stateRoot}/registry.json`, "{ invalid json }");

    const result = await Effect.runPromise(
      Effect.either(readRegistry(stateRoot).pipe(Effect.provide(layer))),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RegistryCorruptionError);
    }
  });

  it("fails with RegistryCorruptionError when JSON fails schema validation", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(`${stateRoot}/registry.json`, JSON.stringify({ version: 99, runs: [] }));

    const result = await Effect.runPromise(
      Effect.either(readRegistry(stateRoot).pipe(Effect.provide(layer))),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RegistryCorruptionError);
    }
  });
});

describe("upsertRun", () => {
  it("inserts a new entry into an empty registry", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const entry = makeEntry("new-run");

    await Effect.runPromise(upsertRun(stateRoot, entry).pipe(Effect.provide(layer)));

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { runs: unknown[] };
    expect(parsed.runs).toHaveLength(1);
  });

  it("updates an existing entry by shortName", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({ version: 1, runs: [makeEntry("my-run", { state: "created" })] }),
    );

    await Effect.runPromise(
      upsertRun(stateRoot, makeEntry("my-run", { state: "running" })).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    const parsed = JSON.parse(raw!) as { runs: Array<{ state: string }> };
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]?.state).toBe("running");
  });

  it("adds a new entry alongside existing ones", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({ version: 1, runs: [makeEntry("run-a")] }),
    );

    await Effect.runPromise(upsertRun(stateRoot, makeEntry("run-b")).pipe(Effect.provide(layer)));

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    const parsed = JSON.parse(raw!) as { runs: unknown[] };
    expect(parsed.runs).toHaveLength(2);
  });
});

describe("setRunStatus", () => {
  it("updates the state of an existing run", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({ version: 1, runs: [makeEntry("my-run", { state: "created" })] }),
    );

    await Effect.runPromise(
      setRunStatus(stateRoot, "my-run", { state: "running" }).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    const parsed = JSON.parse(raw!) as { runs: Array<{ state: string }> };
    expect(parsed.runs[0]?.state).toBe("running");
  });

  it("is a no-op when the run does not exist in the registry", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({ version: 1, runs: [makeEntry("other-run")] }),
    );

    await Effect.runPromise(
      setRunStatus(stateRoot, "nonexistent", { state: "failed" }).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    const parsed = JSON.parse(raw!) as { runs: Array<{ state: string }> };
    expect(parsed.runs[0]?.state).toBe("created");
  });

  it("updates the archivePath field", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({
        version: 1,
        runs: [makeEntry("my-run", { state: "review_open" })],
      }),
    );

    await Effect.runPromise(
      setRunStatus(stateRoot, "my-run", {
        state: "archived",
        archivePath: "/fake-state/archive/my-run",
      }).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    const parsed = JSON.parse(raw!) as { runs: Array<{ archivePath: string }> };
    expect(parsed.runs[0]?.archivePath).toBe("/fake-state/archive/my-run");
  });
});
