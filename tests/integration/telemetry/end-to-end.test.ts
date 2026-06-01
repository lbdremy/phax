import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../../src/app/executePlan.js";
import { createRunFolder } from "../../../src/app/runFolder.js";
import { decodeShortName } from "../../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../../src/domain/branded.js";
import { makeFakeBackend } from "../../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../../src/infra/fakes/systemTelemetry.js";
import { NodeFileSystemLayer } from "../../../src/infra/fs.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../../src/schemas/phaxPlan.js";

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

const shortName = Either.getOrThrow(decodeShortName("my-run"));

const rawPlan = {
  version: 1,
  run: { shortName: "my-run", title: "My Run", branch: "ai/my-run", backend: "claude-code-cli" },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-first",
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

describe("executePlan — semantic telemetry end-to-end", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-e2e-telemetry-test-"));
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("emits the expected semantic event types for a one-phase run", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      repoRoot: stateRoot,
      editorCommand: "echo",
      backend: "claude-code-cli",
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
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

    const fakeTelemetry = makeFakeSystemTelemetry();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      fakeTelemetry.layer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const telEvents = fakeTelemetry.impl.events();
    const telTypes = telEvents.map((e) => e.type);

    // Config steps
    expect(telTypes).toContain("step.started");
    expect(telTypes).toContain("step.completed");
    // Adapter calls
    expect(telTypes).toContain("adapter.call.started");
    expect(telTypes).toContain("adapter.call.succeeded");
    // Artifact captured
    expect(telTypes).toContain("artifact.generated");
    // State transitions from dispatcher
    expect(telTypes).toContain("state.transition");

    // Ordering: agent adapter.call.started before its adapter.call.succeeded
    const startIdx = telEvents.findIndex(
      (e) =>
        e.type === "adapter.call.started" &&
        "adapter" in e &&
        "operation" in e &&
        e.operation === "agent.run",
    );
    const succeededIdx = telEvents.findIndex(
      (e) =>
        e.type === "adapter.call.succeeded" &&
        "adapter" in e &&
        "operation" in e &&
        e.operation === "agent.run",
    );
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(succeededIdx).toBeGreaterThan(startIdx);

    // State transitions are recorded for every handled dispatch.
    const transitions = telEvents.filter((e) => e.type === "state.transition");
    expect(transitions.length).toBeGreaterThan(0);

    // Snapshot the semantic trace projection for the contract.
    const snapshot = fakeTelemetry.impl.getSemanticTraceSnapshot();
    expect(snapshot).toMatchSnapshot("semantic-trace-snapshot");
  });
});
