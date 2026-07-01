import { Effect, Either, Layer } from "effect";
import { describe, it, expect } from "vitest";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import type { ExtractedPhaxPlan } from "../../src/schemas/phaxPlan.js";

// Conforming plan: extractPlanDeterministic parses this without the LLM.
const CONFORMING_PLAN = `# Test Plan

## Required commands

- (none)

## phase-01 — First Phase {#phase-01-first}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat(test): do thing

### Commit body

Does the thing.

---
`;

// Non-conforming plan: missing "## Required commands", so extractPlanDeterministic
// fails. The heading keeps {#phase-01-first} so finalizeExtractedPlan can derive
// the title from it when the LLM path runs.
const NON_CONFORMING_PLAN = `# Test Plan

## phase-01 — First Phase {#phase-01-first}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat(test): do thing

### Commit body

Does the thing.

---
`;

// What the fake LLM backend returns for the non-conforming plan.
const LLM_EXTRACTED: ExtractedPhaxPlan = {
  version: 1,
  run: {
    shortName: "Test Plan",
    title: "Test Plan",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      model: "claude-sonnet-4-6",
      effort: "medium",
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat(test): do thing", body: "Does the thing." },
    },
  ],
};

const BASE_OPTS = {
  planMdPath: "/project/plan.md",
  model: "claude-sonnet-4-6",
  effort: "medium",
  stateRoot: "/state",
  nowIso: "2026-07-01T00:00:00.000Z",
} as const;

function runEffect<E, A>(effect: Effect.Effect<A, E, never>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

describe("loadOrExtractPlan — deterministic-first wiring", () => {
  it("uses the deterministic extractor for a conforming plan without calling the backend", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, CONFORMING_PLAN);

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(Effect.provide(Layer.merge(fsLayer, backendLayer))),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(backend.completeCalls).toHaveLength(0);
    expect(result.right.fromCache).toBe(false);
    expect(result.right.plan.phases[0]!.id).toBe("phase-01");
    expect(result.right.warnings.some((w) => /fell back to LLM/.test(w))).toBe(false);
  });

  it("falls back to the LLM for a non-conforming plan and surfaces the fallback warning", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, NON_CONFORMING_PLAN);
    backend.addCompletionResponse({ finalText: JSON.stringify(LLM_EXTRACTED) });

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(Effect.provide(Layer.merge(fsLayer, backendLayer))),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(backend.completeCalls).toHaveLength(1);
    const fallbackWarning = result.right.warnings.find((w) => w.includes("fell back to LLM"));
    expect(fallbackWarning).toBeDefined();
    expect(fallbackWarning).toMatch(/Deterministic extraction failed/);
    expect(fallbackWarning).toMatch(/fell back to LLM/);
  });

  it("--no-extract succeeds for a conforming plan without calling the backend", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, CONFORMING_PLAN);

    const result = await runEffect(
      loadOrExtractPlan({ ...BASE_OPTS, noExtract: true }).pipe(
        Effect.provide(Layer.merge(fsLayer, backendLayer)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(backend.completeCalls).toHaveLength(0);
    expect(result.right.plan.phases[0]!.id).toBe("phase-01");
  });

  it("--no-extract fails for a non-conforming plan with no cache", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, NON_CONFORMING_PLAN);

    const result = await runEffect(
      loadOrExtractPlan({ ...BASE_OPTS, noExtract: true }).pipe(
        Effect.provide(Layer.merge(fsLayer, backendLayer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left.message).toMatch(/no-extract|no cached/i);
    expect(backend.completeCalls).toHaveLength(0);
  });
});
