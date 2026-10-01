import { readFileSync } from "node:fs";
import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { readRegistry, upsertRun, setRunStatus } from "../../src/app/registry.js";
import { RegistryCorruptionError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { RegistryEntry } from "../../src/schemas/registry.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const stateRoot = "/fake-state";

// The release phax stamps: the root package.json version, read here rather
// than through the generated constant.
const rootVersion = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const makeEntry = (shortName: string, overrides?: Partial<RegistryEntry>): RegistryEntry => ({
  namespace: "test-project",
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

describe("a registry written before $schema (ac-own-legacy)", () => {
  const legacy = {
    version: 1,
    runs: [makeEntry("run-a"), makeEntry("run-b", { state: "completed" })],
  };

  it("still lists its runs", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(`${stateRoot}/registry.json`, JSON.stringify(legacy, null, 2));

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));
    expect(registry).toEqual({ runs: legacy.runs });
  });

  it("is rewritten with $schema first and no version on the next upsert", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(`${stateRoot}/registry.json`, JSON.stringify(legacy, null, 2));

    await Effect.runPromise(upsertRun(stateRoot, makeEntry("run-c")).pipe(Effect.provide(layer)));

    const parsed = JSON.parse(impl.getFile(`${stateRoot}/registry.json`)!) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed)).toEqual(["$schema", "runs"]);
    expect(parsed["$schema"]).toBe(schemaUrl("registry", rootVersion));
    expect(parsed).not.toHaveProperty("version");
    expect(parsed["runs"]).toEqual([...legacy.runs, makeEntry("run-c")]);
  });

  it("is rewritten with $schema on the next status change", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(`${stateRoot}/registry.json`, JSON.stringify(legacy, null, 2));

    await Effect.runPromise(
      setRunStatus(stateRoot, "test-project", "run-a", { state: "running" }).pipe(
        Effect.provide(layer),
      ),
    );

    const parsed = JSON.parse(impl.getFile(`${stateRoot}/registry.json`)!) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed)).toEqual(["$schema", "runs"]);
    expect(parsed["$schema"]).toBe(schemaUrl("registry", rootVersion));
  });
});

describe("readRegistry", () => {
  it("returns an empty registry when the registry file does not exist", async () => {
    const { layer } = makeFakeFileSystem();
    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));
    expect(registry).toEqual({ runs: [] });
  });

  it("reads a registry phax wrote with $schema", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({ $schema: schemaUrl("registry", "0.17.0"), runs: [makeEntry("my-run")] }),
    );

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));
    expect(registry).toEqual({ runs: [makeEntry("my-run")] });
  });

  it("fails with RegistryCorruptionError naming the file when $schema names another format", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({ $schema: schemaUrl("run-status", "0.17.0"), runs: [] }),
    );

    const result = await Effect.runPromise(
      Effect.either(readRegistry(stateRoot).pipe(Effect.provide(layer))),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RegistryCorruptionError);
      expect(result.left.message).toMatch(/^\/fake-state\/registry\.json: .*\$schema/);
    }
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

  // Regression: `rate_limited` is a valid run lifecycle state (added with rate-limit
  // detection) but was missing from the registry schema, so any registry containing a
  // rate-limited run failed to decode and broke `phax run` on startup.
  it("decodes every run lifecycle state, including rate_limited", async () => {
    const states: RegistryEntry["state"][] = [
      "created",
      "running",
      "failed",
      "review_open",
      "completed",
      "stopped",
      "archived",
      "interrupted",
      "rate_limited",
    ];
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({
        version: 1,
        runs: states.map((state, i) => makeEntry(`run-${i}`, { state })),
      }),
    );

    const registry = await Effect.runPromise(readRegistry(stateRoot).pipe(Effect.provide(layer)));
    expect(registry.runs.map((r) => r.state)).toEqual(states);
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
      setRunStatus(stateRoot, "test-project", "my-run", { state: "running" }).pipe(
        Effect.provide(layer),
      ),
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
      setRunStatus(stateRoot, "test-project", "nonexistent", { state: "failed" }).pipe(
        Effect.provide(layer),
      ),
    );

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    const parsed = JSON.parse(raw!) as { runs: Array<{ state: string }> };
    expect(parsed.runs[0]?.state).toBe("created");
  });

  it("is a no-op when the namespace does not match", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(
      `${stateRoot}/registry.json`,
      JSON.stringify({ version: 1, runs: [makeEntry("my-run", { state: "created" })] }),
    );

    await Effect.runPromise(
      setRunStatus(stateRoot, "other-project", "my-run", { state: "running" }).pipe(
        Effect.provide(layer),
      ),
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
      setRunStatus(stateRoot, "test-project", "my-run", {
        state: "archived",
        archivePath: "/fake-state/archive/my-run",
      }).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(`${stateRoot}/registry.json`);
    const parsed = JSON.parse(raw!) as { runs: Array<{ archivePath: string }> };
    expect(parsed.runs[0]?.archivePath).toBe("/fake-state/archive/my-run");
  });
});
