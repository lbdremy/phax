import { Effect, Result, Layer } from "effect";
import { describe, it, expect, vi } from "vitest";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { cacheEntryPath } from "../../src/app/planCacheStore.js";
import { planCacheKey } from "../../src/domain/planCache/key.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import type { PlanExtractionAnswer } from "../../src/schemas/planExtraction.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// Conforming plan: extractPlanDeterministic parses this without the LLM.
const CONFORMING_PLAN = `# Test Plan

## Gate profile

\`standard\`

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
// the title from it when the LLM path runs. It declares its gate profile, which
// phax reads itself on the LLM path too.
const NON_CONFORMING_PLAN = `# Test Plan

## Gate profile

\`light\`

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
const LLM_EXTRACTED: PlanExtractionAnswer = {
  $schema: schemaUrl("phax-plan-extraction", CURRENT_STAMPS["phax-plan-extraction"]),
  plan: {
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
        testLines: [],
        commit: { subject: "feat(test): do thing", body: "Does the thing." },
      },
    ],
  },
  incomplete: null,
};

const BASE_OPTS = {
  planMdPath: "/project/plan.md",
  model: "claude-sonnet-4-6",
  effort: "medium",
  stateRoot: "/state",
  nowIso: "2026-07-01T00:00:00.000Z",
} as const;

function runEffect<E, A>(effect: Effect.Effect<A, E, never>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}

describe("loadOrExtractPlan — deterministic-first wiring", () => {
  it("uses the deterministic extractor for a conforming plan without calling the backend", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, CONFORMING_PLAN);

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(Effect.provide(Layer.merge(fsLayer, backendLayer))),
    );

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(backend.completeCalls).toHaveLength(0);
    expect(result.success.fromCache).toBe(false);
    expect(result.success.plan.phases[0]!.id).toBe("phase-01");
    expect(result.success.warnings.some((w) => /fell back to LLM/.test(w))).toBe(false);
  });

  it("falls back to the LLM for a non-conforming plan and surfaces the fallback warning", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, NON_CONFORMING_PLAN);
    backend.addCompletionResponse({ finalText: JSON.stringify(LLM_EXTRACTED) });

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(Effect.provide(Layer.merge(fsLayer, backendLayer))),
    );

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(backend.completeCalls).toHaveLength(1);
    const fallbackWarning = result.success.warnings.find((w) => w.includes("fell back to LLM"));
    expect(fallbackWarning).toBeDefined();
    expect(fallbackWarning).toMatch(/Deterministic extraction failed/);
    expect(fallbackWarning).toMatch(/fell back to LLM/);
    // The model's answer carries no profile: the run's is plan.md's.
    expect(result.success.plan.run.gateProfile).toBe("light");
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

    expect(Result.isSuccess(result)).toBe(true);
    if (!Result.isSuccess(result)) return;
    expect(backend.completeCalls).toHaveLength(0);
    expect(result.success.plan.phases[0]!.id).toBe("phase-01");
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

    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure.message).toMatch(/no-extract|no cached/i);
    expect(backend.completeCalls).toHaveLength(0);
  });
});

describe("loadOrExtractPlan — a missing or doubled gate-profile declaration", () => {
  const DECLARATION = "## Gate profile\n\n`light`\n\n";

  it.each([
    {
      name: "no declaration",
      plan: NON_CONFORMING_PLAN.replace(DECLARATION, ""),
      defect: "the plan declares no gate profile (## Gate profile)",
    },
    {
      name: "two declarations",
      plan: NON_CONFORMING_PLAN.replace(DECLARATION, `${DECLARATION}## Gate profile\n\nfull\n\n`),
      defect: "the plan declares more than one gate profile (## Gate profile)",
    },
    {
      name: "two ids in one declaration",
      plan: CONFORMING_PLAN.replace("`standard`", "`standard` `light`"),
      defect: "the plan declares more than one gate profile (## Gate profile)",
    },
  ])("refuses $name before the cache and any model call", async ({ plan, defect }) => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, plan);
    backend.addCompletionResponse({ finalText: JSON.stringify(LLM_EXTRACTED) });
    const filesBefore = new Map(fs.files);

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(Effect.provide(Layer.merge(fsLayer, backendLayer))),
    );

    if (Result.isSuccess(result)) throw new Error("unexpected success");
    expect(result.failure.message).toBe(
      `/project/plan.md: ${defect} — run \`phax plans lint /project/plan.md\``,
    );
    expect(backend.completeCalls).toHaveLength(0);
    expect(fs.files).toEqual(filesBefore);
  });
});

describe("loadOrExtractPlan — a plan nested over the limit", () => {
  // Line 32 of the plan file holds a quote nested 33 levels deep.
  const DEEP_PLAN = CONFORMING_PLAN.replace(
    "Does the thing.",
    `Does the thing.\n\n${"> ".repeat(33)}x`,
  );

  it.each([
    { name: "without refresh", refresh: false },
    { name: "with refresh", refresh: true },
  ])("is refused before the cache and any model call, $name", async ({ refresh }) => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(BASE_OPTS.planMdPath, DEEP_PLAN);
    const cachePath = cacheEntryPath(
      BASE_OPTS.stateRoot,
      planCacheKey(DEEP_PLAN, BASE_OPTS.model, BASE_OPTS.effort),
    );
    fs.setFile(cachePath, "cached entry");
    backend.addCompletionResponse({ finalText: JSON.stringify(LLM_EXTRACTED) });
    const readText = vi.spyOn(fs, "readText");
    const filesBefore = new Map(fs.files);

    const result = await runEffect(
      loadOrExtractPlan({ ...BASE_OPTS, refresh }).pipe(
        Effect.provide(Layer.merge(fsLayer, backendLayer)),
      ),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure.message).toBe(
      "/project/plan.md: line 36: blockquotes and lists nest over 32 levels deep — run phax plans lint /project/plan.md",
    );
    expect(backend.completeCalls).toHaveLength(0);
    expect(readText.mock.calls.map(([path]) => path)).toEqual([BASE_OPTS.planMdPath]);
    expect(fs.files).toEqual(filesBefore);
  });
});

describe("loadOrExtractPlan — a path with no canonical form", () => {
  it("is refused before the cache and any model call", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const { impl: backend, layer: backendLayer } = makeFakeBackend();
    fs.setFile(
      BASE_OPTS.planMdPath,
      CONFORMING_PLAN.replace(
        "### Planned files to edit\n\n- (none)",
        "### Planned files to edit\n\n- `../x.ts`",
      ),
    );

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(Effect.provide(Layer.merge(fsLayer, backendLayer))),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) return;
    expect(result.failure.message).toBe(
      `/project/plan.md: phase-01: Planned files to edit: "../x.ts" leaves the repository — run phax plans lint /project/plan.md`,
    );
    expect(backend.completeCalls).toHaveLength(0);
  });
});
