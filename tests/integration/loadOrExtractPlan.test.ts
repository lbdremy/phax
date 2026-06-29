import { describe, it, expect } from "vitest";
import { Effect, Either, Layer } from "effect";
import { PlanValidationError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import type { ExtractedPhaxPlan } from "../../src/schemas/phaxPlan.js";

const PLAN_MD_PATH = "/workspace/plan.md";
const STATE_ROOT = "/fake-state";
const MODEL = "claude-sonnet-4-6";
const EFFORT = "medium";
const NOW_ISO = "2026-06-29T00:00:00.000Z";

const PLAN_MD = `# Plan — My Test Run

## phase-01 — First Phase {#phase-01-first-phase}

Phase description.
`;

const EXTRACTED: ExtractedPhaxPlan = {
  version: 1,
  run: {
    shortName: "my-test-run",
    title: "My Test Run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      model: MODEL,
      effort: EFFORT,
      planMarkdownAnchor: "phase-01-first-phase",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat: do thing", body: "Does the thing." },
    },
  ],
};

const EXTRACTED_JSON = JSON.stringify(EXTRACTED);

function makeLayer(
  fsImpl: ReturnType<typeof makeFakeFileSystem>,
  backendImpl: ReturnType<typeof makeFakeBackend>,
) {
  return Layer.mergeAll(fsImpl.layer, backendImpl.layer);
}

describe("loadOrExtractPlan — cold miss", () => {
  it("extracts once on a cold cache, writes a cache entry, returns fromCache: false", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    fakeBackend.impl.addCompletionResponse({ finalText: EXTRACTED_JSON });

    const result = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: PLAN_MD_PATH,
        model: MODEL,
        effort: EFFORT,
        stateRoot: STATE_ROOT,
        nowIso: NOW_ISO,
      }).pipe(Effect.provide(makeLayer(fakeFs, fakeBackend))),
    );

    expect(result.fromCache).toBe(false);
    expect(result.plan.run.shortName).toBe("my-test-run");
    expect(result.plan.run.branch).toBe("phax/my-test-run");
    expect(result.plan.phases[0]!.title).toBe("First Phase");
    expect(fakeBackend.impl.completeCalls).toHaveLength(1);
  });
});

describe("loadOrExtractPlan — warm hit", () => {
  it("returns fromCache: true on a second call without calling the backend", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    fakeBackend.impl.addCompletionResponse({ finalText: EXTRACTED_JSON });

    const layer = makeLayer(fakeFs, fakeBackend);
    const opts = {
      planMdPath: PLAN_MD_PATH,
      model: MODEL,
      effort: EFFORT,
      stateRoot: STATE_ROOT,
      nowIso: NOW_ISO,
    };

    // First call — populates the cache
    const first = await Effect.runPromise(loadOrExtractPlan(opts).pipe(Effect.provide(layer)));

    // Second call — should hit the cache
    const second = await Effect.runPromise(loadOrExtractPlan(opts).pipe(Effect.provide(layer)));

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.plan.run.shortName).toBe("my-test-run");
    // Backend was called exactly once
    expect(fakeBackend.impl.completeCalls).toHaveLength(1);
  });
});

describe("loadOrExtractPlan — edited plan.md", () => {
  it("treats a changed plan.md as a miss and re-extracts", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    fakeBackend.impl.addCompletionResponse({ finalText: EXTRACTED_JSON });
    fakeBackend.impl.addCompletionResponse({ finalText: EXTRACTED_JSON });

    const layer = makeLayer(fakeFs, fakeBackend);

    // First call with original md
    const first = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: PLAN_MD_PATH,
        model: MODEL,
        effort: EFFORT,
        stateRoot: STATE_ROOT,
        nowIso: NOW_ISO,
      }).pipe(Effect.provide(layer)),
    );

    // Edit the plan.md
    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD + "\nExtra content.");

    // Second call — different md → different key → miss
    const second = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: PLAN_MD_PATH,
        model: MODEL,
        effort: EFFORT,
        stateRoot: STATE_ROOT,
        nowIso: NOW_ISO,
      }).pipe(Effect.provide(layer)),
    );

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(false);
    expect(fakeBackend.impl.completeCalls).toHaveLength(2);
  });
});

describe("loadOrExtractPlan — refresh: true", () => {
  it("re-extracts even on a warm cache and overwrites the entry", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    fakeBackend.impl.addCompletionResponse({ finalText: EXTRACTED_JSON });
    fakeBackend.impl.addCompletionResponse({ finalText: EXTRACTED_JSON });

    const layer = makeLayer(fakeFs, fakeBackend);
    const baseOpts = {
      planMdPath: PLAN_MD_PATH,
      model: MODEL,
      effort: EFFORT,
      stateRoot: STATE_ROOT,
      nowIso: NOW_ISO,
    };

    // Warm up the cache
    await Effect.runPromise(loadOrExtractPlan(baseOpts).pipe(Effect.provide(layer)));

    // Call again with refresh: true
    const refreshed = await Effect.runPromise(
      loadOrExtractPlan({ ...baseOpts, refresh: true }).pipe(Effect.provide(layer)),
    );

    expect(refreshed.fromCache).toBe(false);
    expect(fakeBackend.impl.completeCalls).toHaveLength(2);
  });
});

describe("loadOrExtractPlan — noExtract: true on a miss", () => {
  it("fails without calling the backend when there is no cached entry", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);

    const result = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: PLAN_MD_PATH,
        model: MODEL,
        effort: EFFORT,
        stateRoot: STATE_ROOT,
        nowIso: NOW_ISO,
        noExtract: true,
      })
        .pipe(Effect.provide(makeLayer(fakeFs, fakeBackend)))
        .pipe(Effect.either),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PlanValidationError);
      expect((result.left as PlanValidationError).message).toContain("phax extract-plan");
    }
    expect(fakeBackend.impl.completeCalls).toHaveLength(0);
  });
});
