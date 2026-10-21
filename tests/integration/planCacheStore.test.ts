import { describe, it, expect } from "vitest";
import { Effect, Option } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  readCacheEntry,
  writeCacheEntry,
  cacheEntryPath,
  planMdSha256,
} from "../../src/app/planCacheStore.js";
import { EXTRACTOR_VERSION, planCacheKey } from "../../src/domain/planCache/key.js";
import type { ExtractedPhaxPlan } from "../../src/schemas/phaxPlan.js";

const STATE_ROOT = "/fake-state";
const MODEL = "claude-sonnet-4-6";
const EFFORT = "medium";

const EXTRACTED: ExtractedPhaxPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      model: MODEL,
      effort: EFFORT,
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      mode: "headless",
      oracle: null,
      commit: { subject: "feat: do thing", body: "Does the thing." },
    },
  ],
};

const PLAN_MD = "# Plan — My Run\n\n## phase-01 — First {#phase-01-first}\n";
const KEY = "test-key-abc123";

describe("cacheEntryPath", () => {
  it("returns the expected path", () => {
    const path = cacheEntryPath(STATE_ROOT, "somekey");
    expect(path).toBe("/fake-state/cache/plans/somekey.json");
  });
});

describe("planMdSha256", () => {
  it("returns a 64-character hex string", () => {
    const hash = planMdSha256(PLAN_MD);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same input", () => {
    expect(planMdSha256(PLAN_MD)).toBe(planMdSha256(PLAN_MD));
  });

  it("differs for different inputs", () => {
    expect(planMdSha256("A")).not.toBe(planMdSha256("B"));
  });
});

describe("readCacheEntry — missing file", () => {
  it("returns Option.none for a non-existent entry", async () => {
    const { layer } = makeFakeFileSystem();

    const result = await Effect.runPromise(
      readCacheEntry(STATE_ROOT, KEY).pipe(Effect.provide(layer)),
    );

    expect(Option.isNone(result)).toBe(true);
  });
});

describe("writeCacheEntry + readCacheEntry", () => {
  it("round-trips an ExtractedPhaxPlan", async () => {
    const { layer } = makeFakeFileSystem();

    await Effect.runPromise(
      writeCacheEntry(STATE_ROOT, KEY, {
        planMdSha256: planMdSha256(PLAN_MD),
        model: MODEL,
        effort: EFFORT,
        extractorVersion: 1,
        extractedAt: "2026-01-01T00:00:00.000Z",
        extracted: EXTRACTED,
      }).pipe(Effect.provide(layer)),
    );

    const readResult = await Effect.runPromise(
      readCacheEntry(STATE_ROOT, KEY).pipe(Effect.provide(layer)),
    );

    expect(Option.isSome(readResult)).toBe(true);
    if (Option.isSome(readResult)) {
      expect(readResult.value.run.shortName).toBe("my-run");
      expect(readResult.value.phases[0]!.id).toBe("phase-01");
    }
  });

  it("writes to the expected path", async () => {
    const { impl, layer } = makeFakeFileSystem();

    await Effect.runPromise(
      writeCacheEntry(STATE_ROOT, KEY, {
        planMdSha256: planMdSha256(PLAN_MD),
        model: MODEL,
        effort: EFFORT,
        extractorVersion: 1,
        extractedAt: "2026-01-01T00:00:00.000Z",
        extracted: EXTRACTED,
      }).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(cacheEntryPath(STATE_ROOT, KEY));
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as unknown;
    expect((parsed as Record<string, unknown>)["key"]).toBe(KEY);
    expect((parsed as Record<string, unknown>)["version"]).toBe(1);
  });
});

describe("readCacheEntry — corrupted file", () => {
  it("returns Option.none for invalid JSON", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(cacheEntryPath(STATE_ROOT, KEY), "not-valid-json{{{");

    const result = await Effect.runPromise(
      readCacheEntry(STATE_ROOT, KEY).pipe(Effect.provide(layer)),
    );

    expect(Option.isNone(result)).toBe(true);
  });

  it("returns Option.none for a schema mismatch", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(cacheEntryPath(STATE_ROOT, KEY), JSON.stringify({ version: 1, key: KEY }));

    const result = await Effect.runPromise(
      readCacheEntry(STATE_ROOT, KEY).pipe(Effect.provide(layer)),
    );

    expect(Option.isNone(result)).toBe(true);
  });

  it("never throws on a corrupt entry", async () => {
    const { impl, layer } = makeFakeFileSystem();
    impl.setFile(cacheEntryPath(STATE_ROOT, KEY), "{}");

    await expect(
      Effect.runPromise(readCacheEntry(STATE_ROOT, KEY).pipe(Effect.provide(layer))),
    ).resolves.not.toThrow();
  });
});

describe("readCacheEntry — an entry under extractor version 2", () => {
  it("is never looked up: the version 3 key misses it", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const v2Key = planCacheKey(PLAN_MD, MODEL, EFFORT, 2);
    const { mode: _mode, oracle: _oracle, ...v2Phase } = EXTRACTED.phases[0]!;
    impl.setFile(
      cacheEntryPath(STATE_ROOT, v2Key),
      JSON.stringify({
        version: 1,
        key: v2Key,
        planMdSha256: planMdSha256(PLAN_MD),
        model: MODEL,
        effort: EFFORT,
        extractorVersion: 2,
        extractedAt: "2026-01-01T00:00:00.000Z",
        extracted: { ...EXTRACTED, phases: [v2Phase] },
      }),
    );

    const v3Key = planCacheKey(PLAN_MD, MODEL, EFFORT);
    expect(EXTRACTOR_VERSION).toBe(3);
    expect(v3Key).not.toBe(v2Key);
    const result = await Effect.runPromise(
      readCacheEntry(STATE_ROOT, v3Key).pipe(Effect.provide(layer)),
    );
    expect(Option.isNone(result)).toBe(true);
  });
});
