import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { createRunFolder } from "../../src/app/runFolder.js";
import { createPhaseFolder } from "../../src/app/phaseFolder.js";
import { decodeShortName, type BranchName } from "../../src/domain/branded.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";
import { decodeRunStatus, decodePhaseStatus } from "../../src/schemas/status.js";
import { decodeRegistry } from "../../src/schemas/registry.js";

const stateRoot = "/fake-state";

const resolvedConfig: ResolvedConfig = {
  raw: {
    version: 1,
    project: { name: "test-project", type: "single-package" },
    state: { root: stateRoot },
    gateProfiles: { fast: ["pnpm test"] },
  },
  stateRoot,
  repoRoot: "/fake-repo",
  editorCommand: "zed",
  backend: "claude-code-cli",
  maxFixAttempts: 1,
  extractPlanModel: "claude-haiku-4-5-20251001",
  extractPlanEffort: "low" as const,
  fileReconciliationMode: "report_only" as const,
};

const rawPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "feature/my-run",
    backend: "claude-code-cli",
  },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low",
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
    {
      id: "phase-02",
      title: "Second Phase",
      model: "claude-sonnet-4-6",
      effort: "medium",
      planMarkdownAnchor: "#phase-02-second",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-02): do more", body: "Does more." },
    },
  ],
} as const;

const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

describe("createRunFolder", () => {
  it("creates plan.md, phax-plan.json, phax.json, and run-status.json", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const shortName = Either.getOrThrow(decodeShortName("my-run"));

    await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, resolvedConfig).pipe(Effect.provide(layer)),
    );

    const runPath = `${stateRoot}/runs/my-run`;
    expect(impl.getFile(`${runPath}/plan.md`)).toBe("# My Plan");
    expect(impl.getFile(`${runPath}/phax-plan.json`)).toBeDefined();
    expect(impl.getFile(`${runPath}/phax.json`)).toBeDefined();
    expect(impl.getFile(`${runPath}/run-status.json`)).toBeDefined();
  });

  it("writes a valid run-status.json with state: created", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const shortName = Either.getOrThrow(decodeShortName("my-run"));

    await Effect.runPromise(
      createRunFolder(shortName, "# Plan", plan, resolvedConfig).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(`${stateRoot}/runs/my-run/run-status.json`);
    expect(raw).toBeDefined();
    const decoded = decodeRunStatus(JSON.parse(raw!));
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.state).toBe("created");
      expect(decoded.right.shortName).toBe("my-run");
      expect(decoded.right.phasesCount).toBe(2);
    }
  });

  it("writes the plan JSON with correct phase count", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const shortName = Either.getOrThrow(decodeShortName("my-run"));

    await Effect.runPromise(
      createRunFolder(shortName, "# Plan", plan, resolvedConfig).pipe(Effect.provide(layer)),
    );

    const raw = impl.getFile(`${stateRoot}/runs/my-run/phax-plan.json`);
    const parsed = JSON.parse(raw!) as unknown;
    const decoded = decodePhaxPlan(parsed);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.phases.length).toBe(2);
    }
  });

  it("creates a registry entry for the run", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const shortName = Either.getOrThrow(decodeShortName("my-run"));

    await Effect.runPromise(
      createRunFolder(shortName, "# Plan", plan, resolvedConfig).pipe(Effect.provide(layer)),
    );

    const regRaw = impl.getFile(`${stateRoot}/registry.json`);
    expect(regRaw).toBeDefined();
    const decoded = decodeRegistry(JSON.parse(regRaw!));
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      const entry = decoded.right.runs.find((r) => r.shortName === "my-run");
      expect(entry).toBeDefined();
      expect(entry?.state).toBe("created");
    }
  });

  it("returns the runPath and a non-empty runId", async () => {
    const { layer } = makeFakeFileSystem();
    const shortName = Either.getOrThrow(decodeShortName("my-run"));

    const result = await Effect.runPromise(
      createRunFolder(shortName, "# Plan", plan, resolvedConfig).pipe(Effect.provide(layer)),
    );

    expect(result.runPath).toBe(`${stateRoot}/runs/my-run`);
    expect(result.runId).toMatch(/^my-run-\d+$/);
  });
});

describe("createPhaseFolder", () => {
  it("creates a status.json with state: pending", async () => {
    const { impl, layer } = makeFakeFileSystem();
    const runPath = `${stateRoot}/runs/my-run`;
    const phase = plan.phases[0]!;

    await Effect.runPromise(
      createPhaseFolder(runPath, phase, 0, "feature/my-run--phase-01" as BranchName).pipe(
        Effect.provide(layer),
      ),
    );

    const raw = impl.getFile(`${runPath}/phase-01/status.json`);
    expect(raw).toBeDefined();
    const decoded = decodePhaseStatus(JSON.parse(raw!));
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.state).toBe("pending");
      expect(decoded.right.phaseId).toBe("phase-01");
      expect(decoded.right.phaseIndex).toBe(0);
      expect(decoded.right.model).toBe("claude-sonnet-4-6");
      expect(decoded.right.effort).toBe("low");
    }
  });

  it("returns the phase path", async () => {
    const { layer } = makeFakeFileSystem();
    const runPath = `${stateRoot}/runs/my-run`;
    const phase = plan.phases[0]!;

    const phasePath = await Effect.runPromise(
      createPhaseFolder(runPath, phase, 0, "feature/my-run--phase-01" as BranchName).pipe(
        Effect.provide(layer),
      ),
    );

    expect(phasePath).toBe(`${runPath}/phase-01`);
  });
});
