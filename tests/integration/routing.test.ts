import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import type { SemanticTelemetryEvent } from "../../src/domain/telemetry/events.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { SystemTelemetry } from "../../src/ports/systemTelemetry.js";
import type { TelemetryAttributes } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Phase completed successfully.",
  "## Key decisions and why",
  "No major decisions.",
  "## Exact locations (file paths and exported names)",
  "No new exports.",
  "## What the next phase needs to know",
  "Ready to proceed.",
].join("\n");

const shortName = Either.getOrThrow(decodeShortName("routing-test"));

// Single-phase plan with claude-sonnet-4-6 + medium effort.
// claude-sonnet medium → standard tier → first provider in priority wins.
const rawPlan = {
  version: 1,
  run: {
    shortName: "routing-test",
    title: "Routing Test",
    branch: "ai/routing-test",
    backend: "claude-code-cli",
  },
  phases: [
    {
      id: "phase-01",
      title: "Only Phase",
      model: "claude-sonnet-4-6",
      effort: "medium" as const,
      planMarkdownAnchor: "#phase-01-only",
      plannedFilesToCreate: [] as const,
      plannedFilesToEdit: [] as const,
      optionalFilesToEdit: [] as const,
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

// Routing table identical to the default but with mistral-vibe first.
const mistralFirstRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["mistral-vibe", "claude-code"] as [
    "mistral-vibe" | "claude-code",
    ...("mistral-vibe" | "claude-code" | "codex-cli")[],
  ],
};

function makeCapturingTelemetryLayer(): {
  layer: Layer.Layer<SystemTelemetry>;
  events: SemanticTelemetryEvent[];
} {
  const events: SemanticTelemetryEvent[] = [];
  const layer = Layer.succeed(SystemTelemetry, {
    withOperation: <A, E, R>(
      _name: string,
      _attrs: TelemetryAttributes,
      operation: Effect.Effect<A, E, R>,
    ) => operation,
    recordEvent: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
    recordTransition: (_t) => Effect.void,
    recordError: (_r) => Effect.void,
    incrementCounter: (_n, _a) => Effect.void,
    recordDuration: (_n, _d, _a) => Effect.void,
  });
  return { layer, events };
}

describe("executePlan routing — mistral-vibe priority", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-routing-test-"));
    const worktree = join(stateRoot, "worktrees", "routing-test", "phase-01");
    await mkdir(join(worktree, ".phax-context"), { recursive: true });
    await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("resolves claude-sonnet-4-6/medium to mistral-vibe with the phax alias", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "routing-test", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: ["true"], cleanup: [] },
      },
      stateRoot,
      repoRoot: stateRoot,
      editorCommand: "echo",
      backend: "claude-code-cli",
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,

      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
      },
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "routing-test", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    // Final phase: dirty for commitPhase; cleanupPhase is skipped for final phases
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "abc1234\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const { layer: telemetryLayer, events } = makeCapturingTelemetryLayer();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      telemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Routing Test", plan, config).pipe(Effect.provide(layers)),
    );

    const mistralEnabledProviderConfig = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
      },
    };

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# Routing Test",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
          routing: mistralFirstRouting,
          providerConfig: mistralEnabledProviderConfig,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    // The fake backend should have been called with mistral-vibe as provider
    // and the phax alias as model.
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    const call = fakeBackend.impl.runCalls[0];
    expect(call?.options.provider).toBe("mistral-vibe");
    expect(call?.options.model).toBe("phax-mistral-medium-3.5-medium");
    expect(call?.options.effort).toBe("medium");

    // The agent.model.resolved event should have been recorded.
    const resolvedEvent = events.find((e) => e.type === "agent.model.resolved");
    expect(resolvedEvent).toBeDefined();
    if (resolvedEvent?.type === "agent.model.resolved") {
      expect(resolvedEvent.selectedProvider).toBe("mistral-vibe");
      expect(resolvedEvent.selectedFamily).toBe("mistral-medium");
      expect(resolvedEvent.selectedConcreteModel).toBe("phax-mistral-medium-3.5-medium");
      expect(resolvedEvent.relationship).toBe("equivalent");
      expect(resolvedEvent.requestedFamily).toBe("claude-sonnet");
      expect(resolvedEvent.normalizedTier).toBe("standard");
    }

    // The model-resolution.json artifact should be written in the phase folder.
    const artifactPath = join(runPath, "phase-01", "model-resolution.json");
    const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
      selected: { provider: string; concreteModel: string };
    };
    expect(artifact.selected.provider).toBe("mistral-vibe");
    expect(artifact.selected.concreteModel).toBe("phax-mistral-medium-3.5-medium");
  });
});
