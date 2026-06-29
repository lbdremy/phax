import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { analyzePlanOverlap } from "../../src/app/analyzePlanOverlap.js";
import { EXTRACTOR_VERSION, planCacheKey } from "../../src/domain/planCache/key.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { planMdSha256, cacheEntryPath } from "../../src/app/planCacheStore.js";

const MODEL = "claude-sonnet-4-6";
const EFFORT = "low";
const STATE_ROOT = "/fake/state";
const NOW = "2026-01-01T00:00:00.000Z";

const BASE_OPTS = {
  model: MODEL,
  effort: EFFORT,
  stateRoot: STATE_ROOT,
  noExtract: false,
  nowIso: NOW,
};

function makePlanMd(shortName: string, files: string[]): string {
  return [
    `# Plan — ${shortName}`,
    "",
    `## phase-01 — First phase {#phase-01-first}`,
    "",
    "Some content.",
  ].join("\n");
}

function makeCacheEntry(
  planMd: string,
  shortName: string,
  filesToCreate: string[],
  filesToEdit: string[],
) {
  const key = planCacheKey(planMd, MODEL, EFFORT);
  const entry = {
    version: 1,
    key,
    planMdSha256: planMdSha256(planMd),
    model: MODEL,
    effort: EFFORT,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: NOW,
    extracted: {
      version: 1,
      run: {
        shortName,
        title: `Plan — ${shortName}`,
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          model: MODEL,
          effort: EFFORT,
          planMarkdownAnchor: "phase-01-first",
          plannedFilesToCreate: filesToCreate,
          plannedFilesToEdit: filesToEdit,
          optionalFilesToEdit: [],
          commit: { subject: `feat: ${shortName}`, body: "body" },
        },
      ],
    },
  };
  return { key, entry, path: cacheEntryPath(STATE_ROOT, key) };
}

function setup(
  plans: Array<{ path: string; md: string; shortName: string; creates: string[]; edits: string[] }>,
) {
  const fakeBackend = makeFakeBackend();
  const fakeFs = makeFakeFileSystem();

  for (const p of plans) {
    fakeFs.impl.setFile(p.path, p.md);
    const { path, entry } = makeCacheEntry(p.md, p.shortName, p.creates, p.edits);
    fakeFs.impl.setFile(path, JSON.stringify(entry));
  }

  const layer = Layer.mergeAll(fakeBackend.layer, fakeFs.layer);
  return { fakeBackend, fakeFs, layer };
}

describe("analyzePlanOverlap", () => {
  it("returns cleanPairs for two plans with disjoint footprints", async () => {
    const planA = {
      path: "/repo/plans/a.md",
      md: makePlanMd("plan-a", []),
      shortName: "plan-a",
      creates: ["src/foo.ts"],
      edits: [],
    };
    const planB = {
      path: "/repo/plans/b.md",
      md: makePlanMd("plan-b", []),
      shortName: "plan-b",
      creates: ["src/bar.ts"],
      edits: [],
    };
    const { layer } = setup([planA, planB]);

    const result = await Effect.runPromise(
      analyzePlanOverlap([planA.path, planB.path], BASE_OPTS).pipe(Effect.provide(layer)),
    );

    expect(result.edges).toHaveLength(0);
    expect(result.cleanPairs).toHaveLength(1);
    expect(result.cleanPairs[0]).toEqual([planA.path, planB.path]);
    expect(result.largestParallelSafeSet).toContain(planA.path);
    expect(result.largestParallelSafeSet).toContain(planB.path);
  });

  it("returns a medium edge for two plans sharing a source file via edit", async () => {
    const planA = {
      path: "/repo/plans/a.md",
      md: makePlanMd("plan-a", []),
      shortName: "plan-a",
      creates: [],
      edits: ["src/shared.ts"],
    };
    const planB = {
      path: "/repo/plans/b.md",
      md: makePlanMd("plan-b", []),
      shortName: "plan-b",
      creates: [],
      edits: ["src/shared.ts"],
    };
    const { layer } = setup([planA, planB]);

    const result = await Effect.runPromise(
      analyzePlanOverlap([planA.path, planB.path], BASE_OPTS).pipe(Effect.provide(layer)),
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.severity).toBe("medium");
    expect(result.edges[0]?.shared[0]?.path).toBe("src/shared.ts");
    expect(result.cleanPairs).toHaveLength(0);
  });

  it("does not call backend on second call for already-cached plans (warm hit)", async () => {
    const planA = {
      path: "/repo/plans/a.md",
      md: makePlanMd("plan-a", []),
      shortName: "plan-a",
      creates: ["src/foo.ts"],
      edits: [],
    };
    const planB = {
      path: "/repo/plans/b.md",
      md: makePlanMd("plan-b", []),
      shortName: "plan-b",
      creates: ["src/bar.ts"],
      edits: [],
    };
    const { layer, fakeBackend } = setup([planA, planB]);

    await Effect.runPromise(
      analyzePlanOverlap([planA.path, planB.path], BASE_OPTS).pipe(Effect.provide(layer)),
    );
    await Effect.runPromise(
      analyzePlanOverlap([planA.path, planB.path], BASE_OPTS).pipe(Effect.provide(layer)),
    );

    expect(fakeBackend.impl.completeCalls).toHaveLength(0);
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });

  it("fails with a message naming the offending path when a plan cannot be loaded", async () => {
    const planA = {
      path: "/repo/plans/a.md",
      md: makePlanMd("plan-a", []),
      shortName: "plan-a",
      creates: ["src/foo.ts"],
      edits: [],
    };
    const fakeBackend = makeFakeBackend();
    const fakeFs = makeFakeFileSystem();
    // Only seed planA, planB is missing
    fakeFs.impl.setFile(planA.path, planA.md);
    const { path, entry } = makeCacheEntry(planA.md, planA.shortName, planA.creates, planA.edits);
    fakeFs.impl.setFile(path, JSON.stringify(entry));
    const layer = Layer.mergeAll(fakeBackend.layer, fakeFs.layer);

    const result = await Effect.runPromise(
      analyzePlanOverlap([planA.path, "/repo/plans/missing.md"], BASE_OPTS).pipe(
        Effect.either,
        Effect.provide(layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("/repo/plans/missing.md");
    }
  });

  it("fails without calling backend when noExtract is true and plan is uncached", async () => {
    const fakeBackend = makeFakeBackend();
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      "/repo/plans/a.md",
      "# some plan\n\n## phase-01 — Phase {#phase-01-x}\n\nContent.",
    );
    fakeFs.impl.setFile(
      "/repo/plans/b.md",
      "# some plan b\n\n## phase-01 — Phase {#phase-01-x}\n\nContent.",
    );
    const layer = Layer.mergeAll(fakeBackend.layer, fakeFs.layer);

    const result = await Effect.runPromise(
      analyzePlanOverlap(["/repo/plans/a.md", "/repo/plans/b.md"], {
        ...BASE_OPTS,
        noExtract: true,
      }).pipe(Effect.either, Effect.provide(layer)),
    );

    expect(Either.isLeft(result)).toBe(true);
    expect(fakeBackend.impl.completeCalls).toHaveLength(0);
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });

  it("fails with a two-or-more message when fewer than two distinct paths are given", async () => {
    const planA = {
      path: "/repo/plans/a.md",
      md: makePlanMd("plan-a", []),
      shortName: "plan-a",
      creates: [],
      edits: [],
    };
    const { layer } = setup([planA]);

    const singleResult = await Effect.runPromise(
      analyzePlanOverlap([planA.path], BASE_OPTS).pipe(Effect.either, Effect.provide(layer)),
    );
    expect(Either.isLeft(singleResult)).toBe(true);
    if (Either.isLeft(singleResult)) {
      expect(singleResult.left.message).toContain("two or more");
    }

    // Same path twice → still treated as one unique path
    const dupeResult = await Effect.runPromise(
      analyzePlanOverlap([planA.path, planA.path], BASE_OPTS).pipe(
        Effect.either,
        Effect.provide(layer),
      ),
    );
    expect(Either.isLeft(dupeResult)).toBe(true);
    if (Either.isLeft(dupeResult)) {
      expect(dupeResult.left.message).toContain("two or more");
    }
  });

  it("label carries the run shortName and path", async () => {
    const planA = {
      path: "/repo/plans/a.md",
      md: makePlanMd("my-feature", []),
      shortName: "my-feature",
      creates: ["src/foo.ts"],
      edits: [],
    };
    const planB = {
      path: "/repo/plans/b.md",
      md: makePlanMd("other-plan", []),
      shortName: "other-plan",
      creates: ["src/bar.ts"],
      edits: [],
    };
    const { layer } = setup([planA, planB]);

    const result = await Effect.runPromise(
      analyzePlanOverlap([planA.path, planB.path], BASE_OPTS).pipe(Effect.provide(layer)),
    );

    const labels = result.footprints.map((f) => f.label);
    expect(labels).toContain(`my-feature (${planA.path})`);
    expect(labels).toContain(`other-plan (${planB.path})`);
  });
});
