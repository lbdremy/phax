import { Effect, Either, Layer } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { freshRunPreflight } from "../../src/app/runPreflight.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { UnsafeGitStateError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { readPhaxPlanFile } from "../../src/schemas/persisted.js";
import type { PhaxPlan } from "../../src/schemas/phaxPlan.js";

const DIRTY_MESSAGE = "Working tree is not clean. Commit or stash changes, or pass --allow-dirty.";

const shortName = Either.getOrThrow(decodeShortName("dirty-run"));

function makePlan(): PhaxPlan {
  return Either.getOrThrow(
    readPhaxPlanFile("phax-plan.json", {
      version: 1,
      run: {
        shortName: "dirty-run",
        title: "Dirty Run",
        branch: "phax/dirty-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: ["src/x.ts"],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase 1", body: "Phase 1." },
        },
      ],
    }),
  );
}

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root: stateRoot },
      gateProfiles: {
        full: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
      },
    },
    stateRoot,
    namespace: "test-project",
    repoRoot: stateRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
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

describe("phax run — dirty tree at branch creation is still refused (spec Q2)", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-dirty-branch-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("refuses with the dirty-tree error and exit 3 before any branch is created", async () => {
    const plan = makePlan();
    const config = makeConfig(stateRoot);
    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    const fakeBackend = makeFakeBackend();

    // The fresh-run preflight sees a clean tree. Its routing load reads an
    // in-memory filesystem, so the developer's ~/.phax is never consulted.
    const preflight = await Effect.runPromise(
      Effect.either(
        freshRunPreflight({
          plan,
          config,
          gateProfileId: "full",
          namespace: "test-project",
          allowSkillEdits: false,
          allowDirty: false,
        }).pipe(Effect.provide(makeFakeFileSystem().layer), Effect.provide(fakeGit.layer)),
      ),
    );
    expect(Either.isRight(preflight)).toBe(true);
    if (Either.isLeft(preflight)) return;
    const { routing, providerConfig } = preflight.right;

    // The tree turns dirty between the preflight and branch creation.
    fakeGit.impl.setRepoIsClean(false);

    const layer = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const result = await Effect.runPromise(
      Effect.either(
        createRunFolder(shortName, "# Dirty Run", plan, config).pipe(
          Effect.flatMap(({ runPath, runId }) =>
            executePlan({
              shortName,
              namespace: "test-project",
              plan,
              planMd: "# Dirty Run",
              config,
              gateProfileId: "full",
              allowDirty: false,
              runPath,
              runId,
              startIndex: 0,
              routing,
              providerConfig,
            }),
          ),
          Effect.provide(layer),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnsafeGitStateError);
      expect(result.left.message).toBe(DIRTY_MESSAGE);
      expect(exitCodeForError(result.left)).toBe(3);
    }
    expect(fakeGit.impl.calls.filter((c) => c.method === "createBranch")).toEqual([]);
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });
});
