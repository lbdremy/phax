import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { Backend, type BackendOps } from "../../src/ports/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { AgentInvocationError, PlanValidationError } from "../../src/domain/errors.js";

// A plan.md that the deterministic extractor can parse fully.
const CONFORMING_PLAN_MD = [
  "# Test Run",
  "",
  "## Required commands",
  "",
  "- (none)",
  "",
  "## phase-01 — Alpha Phase {#phase-01-alpha}",
  "",
  "**Recommended model:** claude-sonnet-4-6",
  "**Recommended effort:** medium",
  "",
  "### Planned files to create",
  "",
  "- (none)",
  "",
  "### Planned files to edit",
  "",
  "- (none)",
  "",
  "### Optional files that may be edited",
  "",
  "- (none)",
  "",
  "### Commit subject",
  "",
  "feat: do thing",
  "",
  "### Commit body",
  "",
  "Does the thing.",
  "",
].join("\n");

// A plan.md missing the Required commands section — deterministic parse fails.
const NON_CONFORMING_PLAN_MD = [
  "# Test Run",
  "",
  "## phase-01 — Alpha Phase {#phase-01-alpha}",
  "",
  "**Recommended model:** claude-sonnet-4-6",
  "**Recommended effort:** medium",
  "",
  "Some description without proper sections.",
].join("\n");

// Valid ExtractedPhaxPlan JSON for the fake backend to return on LLM fallback.
const LLM_EXTRACTED_PLAN = {
  version: 1,
  run: {
    shortName: "test-run",
    title: "Test Run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      model: "claude-sonnet-4-6",
      effort: "medium",
      planMarkdownAnchor: "#phase-01-alpha",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat: do thing", body: "Does the thing." },
    },
  ],
};

const PLAN_PATH = "/repo/plan.md";
const STATE_ROOT = "/state";

const BASE_OPTS = {
  planMdPath: PLAN_PATH,
  model: "claude-sonnet-4-6",
  effort: "medium",
  stateRoot: STATE_ROOT,
  nowIso: "2026-01-01T00:00:00.000Z",
};

function makeFakeBackend() {
  let completeCalls = 0;
  const ops: BackendOps = {
    runAgent: () => Effect.fail(new AgentInvocationError({ message: "not expected in this test" })),
    resumeAgentSession: () =>
      Effect.fail(new AgentInvocationError({ message: "not expected in this test" })),
    complete: (_prompt, _opts) => {
      completeCalls++;
      return Effect.succeed({ finalText: JSON.stringify(LLM_EXTRACTED_PLAN) });
    },
  };
  const layer = Layer.succeed(Backend, ops);
  return { layer, getCompleteCalls: () => completeCalls };
}

async function runEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

describe("loadOrExtractPlan — deterministic-first wiring", () => {
  it("conforming plan: backend is not called and fromCache is false", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PLAN_PATH, CONFORMING_PLAN_MD);
    const fakeBackend = makeFakeBackend();

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(
        Effect.provide(fakeFs.layer),
        Effect.provide(fakeBackend.layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(fakeBackend.getCompleteCalls()).toBe(0);
      expect(result.right.fromCache).toBe(false);
    }
  });

  it("conforming plan: returned plan has the expected phase title and id", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PLAN_PATH, CONFORMING_PLAN_MD);
    const fakeBackend = makeFakeBackend();

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(
        Effect.provide(fakeFs.layer),
        Effect.provide(fakeBackend.layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const { plan } = result.right;
      expect(plan.phases).toHaveLength(1);
      expect(plan.phases[0]!.id).toBe("phase-01");
      expect(plan.phases[0]!.title).toBe("Alpha Phase");
    }
  });

  it("non-conforming plan: backend is called exactly once and warning mentions LLM fallback", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PLAN_PATH, NON_CONFORMING_PLAN_MD);
    const fakeBackend = makeFakeBackend();

    const result = await runEffect(
      loadOrExtractPlan(BASE_OPTS).pipe(
        Effect.provide(fakeFs.layer),
        Effect.provide(fakeBackend.layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(fakeBackend.getCompleteCalls()).toBe(1);
      expect(result.right.warnings.some((w) => w.includes("fell back to LLM"))).toBe(true);
    }
  });

  it("--no-extract with conforming plan: succeeds without calling the backend", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PLAN_PATH, CONFORMING_PLAN_MD);
    const fakeBackend = makeFakeBackend();

    const result = await runEffect(
      loadOrExtractPlan({ ...BASE_OPTS, noExtract: true }).pipe(
        Effect.provide(fakeFs.layer),
        Effect.provide(fakeBackend.layer),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    expect(fakeBackend.getCompleteCalls()).toBe(0);
  });

  it("--no-extract with non-conforming plan and no cache: fails with PlanValidationError", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PLAN_PATH, NON_CONFORMING_PLAN_MD);
    const fakeBackend = makeFakeBackend();

    const result = await runEffect(
      loadOrExtractPlan({ ...BASE_OPTS, noExtract: true }).pipe(
        Effect.provide(fakeFs.layer),
        Effect.provide(fakeBackend.layer),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PlanValidationError);
    }
    expect(fakeBackend.getCompleteCalls()).toBe(0);
  });
});
