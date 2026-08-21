import { Effect, Either, Layer } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { ModelPreflightError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";

const shortName = Either.getOrThrow(decodeShortName("preflight-run"));

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root: stateRoot },
      gateProfiles: { full: [{ command: "true", surface: "local", firing: "every-phase" }] },
      commands: { setup: [], cleanup: [] },
    },
    stateRoot,
    namespace: "test-project",
    repoRoot: stateRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  };
}

function makeLayers() {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  const fakeShell = makeFakeShell();
  const fakeBackend = makeFakeBackend();
  const fakeGitHub = makeFakeGitHub();
  return {
    layer: Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      fakeGitHub.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    ),
    fakeBackend,
  };
}

describe("executePlan — model preflight", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-model-preflight-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("fails with ModelPreflightError before any agent runs when a phase model is not in the catalog", async () => {
    const rawPlan = {
      version: 1,
      run: {
        shortName: "preflight-run",
        title: "Preflight Run",
        branch: "ai/preflight-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "completely-unknown-model-xyz",
          effort: "medium" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: do thing", body: "Does the thing." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);
    const { layer, fakeBackend } = makeLayers();

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Preflight Run", plan, config).pipe(Effect.provide(layer)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# Preflight Run",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ModelPreflightError);
      const err = result.left as ModelPreflightError;
      expect(err.failures).toHaveLength(1);
      expect(err.failures[0]?.phaseId).toBe("phase-01");
      expect(err.failures[0]?.model).toBe("completely-unknown-model-xyz");
      expect(err.failures[0]?.reasons[0]).toContain("not found in catalog");
      expect(err.message).toContain("phase-01");
    }

    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });

  it("fails with ModelPreflightError when a phase requests an unsupported effort", async () => {
    const rawPlan = {
      version: 1,
      run: {
        shortName: "preflight-run",
        title: "Preflight Run",
        branch: "ai/preflight-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          // claude-sonnet-4-6 supports low/medium/high/max; ultracode is not in the list
          model: "claude-sonnet-4-6",
          effort: "ultracode" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: do thing", body: "Does the thing." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);
    const { layer, fakeBackend } = makeLayers();

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Preflight Run", plan, config).pipe(Effect.provide(layer)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# Preflight Run",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ModelPreflightError);
      const err = result.left as ModelPreflightError;
      expect(err.failures[0]?.reasons[0]).toContain("ultracode");
      expect(err.failures[0]?.reasons[0]).toContain("not supported");
      // The structured failure carries the catalog-derived alternatives so a
      // machine-readable consumer sees the same self-correction hint as the
      // rendered message (nearest supported efforts for the requested model).
      const alt = err.failures[0]?.alternatives[0];
      expect(alt?.id).toBe("claude-sonnet-4-6");
      expect(alt?.family).toBe("claude-sonnet");
      expect(alt?.efforts.length).toBeGreaterThan(0);
    }

    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });

  it("does not fail with ModelPreflightError when all phase models are valid", async () => {
    const rawPlan = {
      version: 1,
      run: {
        shortName: "preflight-run",
        title: "Preflight Run",
        branch: "ai/preflight-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "claude-sonnet-4-6",
          effort: "medium" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: do thing", body: "Does the thing." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);
    const { layer } = makeLayers();

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Preflight Run", plan, config).pipe(Effect.provide(layer)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# Preflight Run",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layer)),
      ),
    );

    // The run may fail for other reasons (no backend responses) but never
    // with a ModelPreflightError since the model is valid.
    if (Either.isLeft(result)) {
      expect(result.left).not.toBeInstanceOf(ModelPreflightError);
    }
  });

  it("names all failing phases in the error when multiple phases are invalid", async () => {
    const rawPlan = {
      version: 1,
      run: {
        shortName: "preflight-run",
        title: "Preflight Run",
        branch: "ai/preflight-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "bad-model-one",
          effort: "medium" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase 1", body: "Phase 1." },
        },
        {
          id: "phase-02",
          title: "Second Phase",
          model: "bad-model-two",
          effort: "high" as const,
          planMarkdownAnchor: "#phase-02",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase 2", body: "Phase 2." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);
    const { layer, fakeBackend } = makeLayers();

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Preflight Run", plan, config).pipe(Effect.provide(layer)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# Preflight Run",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ModelPreflightError);
      const err = result.left as ModelPreflightError;
      expect(err.failures).toHaveLength(2);
      const phaseIds = err.failures.map((f) => f.phaseId);
      expect(phaseIds).toContain("phase-01");
      expect(phaseIds).toContain("phase-02");
      expect(err.message).toContain("phase-01");
      expect(err.message).toContain("phase-02");
    }

    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });
});
