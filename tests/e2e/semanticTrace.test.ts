/**
 * Doctrine §15 — proof-preserving iteration.
 *
 * This test drives the happy path end-to-end (using controlled fakes for external
 * services so the flow is deterministic) and snapshots the SemanticTraceSnapshot
 * projection. Future refactors that alter the event sequence must update this baseline
 * intentionally with `--update-snapshot`. See docs/observability.md for the doctrine.
 *
 * Gate: set PHAX_E2E_RUN=1 to run. The test uses fake adapters — no real `claude`
 * binary is required.
 */

import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";
import { withTelemetryCapture } from "./helpers/telemetry.js";

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

const UNSTABLE_FIELD_NAMES = ["timestamp", "traceId", "spanId", "durationMs"] as const;

const shouldRun = process.env["PHAX_E2E_RUN"] === "1";

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
      plannedFilesToCreate: [] as const,
      plannedFilesToEdit: [] as const,
      optionalFilesToEdit: [] as const,
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

describe.skipIf(!shouldRun)("E2E semantic trace — happy-path snapshot", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-e2e-semantic-trace-"));
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("captures the full semantic trace for a one-phase happy-path run and pins the projection", async () => {
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

    // Compose InMemoryTelemetry on top of NoopSystemTelemetryLayer — this is the
    // pattern for adding capture alongside any real telemetry layer.
    const telemetry = withTelemetryCapture(NoopSystemTelemetryLayer);

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      telemetry.layer,
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

    const snapshot = telemetry.impl.getSemanticTraceSnapshot();

    // Guard: the projection must never leak unstable transport fields.
    const serialized = JSON.stringify(snapshot);
    for (const field of UNSTABLE_FIELD_NAMES) {
      expect(serialized, `snapshot must not contain unstable field "${field}"`).not.toContain(
        `"${field}"`,
      );
    }
    // No 13+ digit Unix timestamp values.
    expect(serialized, "snapshot must not contain raw Unix timestamps").not.toMatch(/\b\d{13,}\b/);

    // Pin the projection. A future refactor that changes the event sequence must
    // explicitly update this baseline with --update-snapshot.
    expect(snapshot).toMatchSnapshot("happy-path-semantic-trace");
  });
});
