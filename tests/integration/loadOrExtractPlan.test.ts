import { describe, it, expect } from "vitest";
import { Effect, Either, Layer } from "effect";
import { PlanValidationError } from "../../src/domain/errors.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { planCacheKey } from "../../src/domain/planCache/key.js";
import { cacheEntryPath, planMdSha256 } from "../../src/app/planCacheStore.js";
import type { ExtractionAnswer } from "../../src/schemas/phaxPlan.js";

const PLAN_MD_PATH = "/workspace/plan.md";
const STATE_ROOT = "/fake-state";
const MODEL = "claude-sonnet-4-6";
const EFFORT = "medium";
const NOW_ISO = "2026-06-29T00:00:00.000Z";

const PLAN_MD = `# Plan — My Test Run

## phase-01 — First Phase {#phase-01-first-phase}

Phase description.
`;

// The extraction model's answer: no mode and no oracle, phax reads those.
const EXTRACTED: ExtractionAnswer = {
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
      testLines: [],
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

describe("loadOrExtractPlan — extraction is not gated by lifecycle status", () => {
  it("extracts a Draft plan successfully — extraction has no status gate", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();

    const draftPlanMd = `---\nstatus: Draft\nsource-spec: null\n---\n# Plan — My Test Run\n\n## phase-01 — First Phase {#phase-01-first-phase}\n\nPhase description.\n`;
    fakeFs.impl.setFile(PLAN_MD_PATH, draftPlanMd);
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
      expect((result.left as PlanValidationError).message).toContain("--no-extract");
    }
    expect(fakeBackend.impl.completeCalls).toHaveLength(0);
  });

  it("does not read an entry keyed under extractor version 2", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    const v2Key = planCacheKey(PLAN_MD, MODEL, EFFORT, 2);
    fakeFs.impl.setFile(
      cacheEntryPath(STATE_ROOT, v2Key),
      JSON.stringify({
        version: 1,
        key: v2Key,
        planMdSha256: planMdSha256(PLAN_MD),
        model: MODEL,
        effort: EFFORT,
        extractorVersion: 2,
        extractedAt: NOW_ISO,
        extracted: EXTRACTED,
      }),
    );

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
      expect((result.left as PlanValidationError).message).toContain("--no-extract");
    }
    expect(fakeBackend.impl.completeCalls).toHaveLength(0);
  });
});

describe("loadOrExtractPlan — a departing test line", () => {
  const DEPARTING_PLAN_MD = [
    PLAN_MD,
    "### Test strategy",
    "",
    "- a row renders — small · example · the row · in-phase",
    "- add unit tests for the exporter",
    "",
  ].join("\n");

  function run(opts: { readonly refresh?: boolean } = {}) {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();
    fakeFs.impl.setFile(PLAN_MD_PATH, DEPARTING_PLAN_MD);
    // A cache entry under the plan's own key would be a hit: it is never read.
    const key = planCacheKey(DEPARTING_PLAN_MD, MODEL, EFFORT);
    const [phase] = EXTRACTED.phases;
    const { testLines, commit, ...fields } = phase;
    fakeFs.impl.setFile(
      cacheEntryPath(STATE_ROOT, key),
      JSON.stringify({
        version: 1,
        key,
        planMdSha256: planMdSha256(DEPARTING_PLAN_MD),
        model: MODEL,
        effort: EFFORT,
        extractorVersion: 4,
        extractedAt: NOW_ISO,
        extracted: {
          ...EXTRACTED,
          phases: [{ ...fields, mode: "headless", oracle: null, testLines, commit }],
        },
      }),
    );
    fakeBackend.impl.addCompletionResponse({ finalText: EXTRACTED_JSON });
    const filesBefore = new Map(fakeFs.impl.files);
    const result = Effect.runPromise(
      loadOrExtractPlan({
        planMdPath: PLAN_MD_PATH,
        model: MODEL,
        effort: EFFORT,
        stateRoot: STATE_ROOT,
        nowIso: NOW_ISO,
        refresh: opts.refresh,
      }).pipe(Effect.provide(makeLayer(fakeFs, fakeBackend)), Effect.either),
    );
    return { result, fakeFs, fakeBackend, filesBefore };
  }

  it("refuses before the cache and the model, naming the line and phax plans lint", async () => {
    const { result, fakeFs, fakeBackend, filesBefore } = run();
    const either = await result;

    expect(Either.isLeft(either)).toBe(true);
    if (Either.isLeft(either)) {
      expect(either.left).toBeInstanceOf(PlanValidationError);
      expect((either.left as PlanValidationError).message).toBe(
        `${PLAN_MD_PATH}: phase-01 test line 2 departs from the format: "add unit tests for the exporter" — run phax plans lint ${PLAN_MD_PATH}`,
      );
    }
    expect(fakeBackend.impl.completeCalls).toHaveLength(0);
    expect(fakeFs.impl.files).toEqual(filesBefore);
  });

  it("refuses with refresh too, never asking the model", async () => {
    const { result, fakeBackend } = run({ refresh: true });

    expect(Either.isLeft(await result)).toBe(true);
    expect(fakeBackend.impl.completeCalls).toHaveLength(0);
  });
});
