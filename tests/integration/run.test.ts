import { describe, it, expect } from "vitest";
import { Effect, Either, Layer } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import type { ExtractedPhaxPlan } from "../../src/schemas/phaxPlan.js";

// Integration test: verifies that phax run's extraction step (loadOrExtractPlan)
// reuses a cached extraction across calls and re-extracts only on --refresh.

const PLAN_MD_PATH = "/project/plan.md";
const STATE_ROOT = "/fake-state";
const MODEL = "claude-sonnet-4-6";
const EFFORT = "medium";
const NOW_ISO = "2026-06-29T00:00:00.000Z";

const PLAN_MD = `# Plan — Run Cache Test

## phase-01 — First Phase {#phase-01-first-phase}

Phase description.
`;

const EXTRACTED: ExtractedPhaxPlan = {
  version: 1,
  run: {
    shortName: "run-cache-test",
    title: "Run Cache Test",
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
      commit: { subject: "feat: phase one", body: "Does phase one." },
    },
  ],
};

function makeLayer(
  fsImpl: ReturnType<typeof makeFakeFileSystem>,
  backendImpl: ReturnType<typeof makeFakeBackend>,
) {
  return Layer.mergeAll(fsImpl.layer, backendImpl.layer);
}

function makeBaseOpts() {
  return {
    planMdPath: PLAN_MD_PATH,
    model: MODEL,
    effort: EFFORT,
    stateRoot: STATE_ROOT,
    nowIso: NOW_ISO,
  };
}

describe("run — extraction cache", () => {
  it("warm cache skips the backend (simulates extract-plan then run)", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();
    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    fakeBackend.impl.addCompletionResponse({ finalText: JSON.stringify(EXTRACTED) });

    const layer = makeLayer(fakeFs, fakeBackend);
    const opts = makeBaseOpts();

    // First call — simulates `phax extract-plan` or a prior `phax run`
    const first = await Effect.runPromise(loadOrExtractPlan(opts).pipe(Effect.provide(layer)));
    expect(first.fromCache).toBe(false);
    expect(fakeBackend.impl.completeCalls).toHaveLength(1);

    // Second call — simulates `phax run` with the same plan.md (warm cache)
    const second = await Effect.runPromise(loadOrExtractPlan(opts).pipe(Effect.provide(layer)));
    expect(second.fromCache).toBe(true);
    expect(second.plan.run.shortName).toBe("run-cache-test");
    expect(second.plan.run.branch).toBe("phax/run-cache-test");
    // Backend must not have been called again
    expect(fakeBackend.impl.completeCalls).toHaveLength(1);
  });

  it("--refresh forces a backend call even on a warm cache", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();
    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    fakeBackend.impl.addCompletionResponse({ finalText: JSON.stringify(EXTRACTED) });
    fakeBackend.impl.addCompletionResponse({ finalText: JSON.stringify(EXTRACTED) });

    const layer = makeLayer(fakeFs, fakeBackend);
    const opts = makeBaseOpts();

    // Warm up the cache
    await Effect.runPromise(loadOrExtractPlan(opts).pipe(Effect.provide(layer)));
    expect(fakeBackend.impl.completeCalls).toHaveLength(1);

    // --refresh must bypass the cache
    const refreshed = await Effect.runPromise(
      loadOrExtractPlan({ ...opts, refresh: true }).pipe(Effect.provide(layer)),
    );
    expect(refreshed.fromCache).toBe(false);
    expect(fakeBackend.impl.completeCalls).toHaveLength(2);
  });

  it("an extract-plan then run of the same md is a single backend call", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeBackend = makeFakeBackend();
    fakeFs.impl.setFile(PLAN_MD_PATH, PLAN_MD);
    fakeBackend.impl.addCompletionResponse({ finalText: JSON.stringify(EXTRACTED) });

    const layer = makeLayer(fakeFs, fakeBackend);
    const opts = makeBaseOpts();

    // Simulate `phax extract-plan` populating the cache
    const extractResult = await Effect.runPromise(
      loadOrExtractPlan(opts).pipe(Effect.provide(layer)),
    );
    expect(extractResult.fromCache).toBe(false);

    // Simulate `phax run` with the same plan.md — must reuse the cache
    const runResult = await Effect.runPromise(loadOrExtractPlan(opts).pipe(Effect.provide(layer)));
    expect(runResult.fromCache).toBe(true);
    expect(runResult.plan.run.shortName).toBe("run-cache-test");

    // Total: exactly one LLM call for both commands combined
    expect(fakeBackend.impl.completeCalls).toHaveLength(1);
  });
});
