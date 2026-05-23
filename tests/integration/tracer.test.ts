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
import { makeFakeTracer } from "../../src/infra/fakes/tracer.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
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

function sanitizePath(path: string): string {
  return path.replace(/\/var\/folders\/[^/]+\/[^/]+\/T\/[^/]+/, "<tmpdir>");
}

function sanitizeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return details;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (key === "eventId") {
      sanitized[key] = "<uuid>";
    } else if (typeof value === "string" && value.includes("/")) {
      sanitized[key] = sanitizePath(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

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

describe("executePlan — tracing", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-trace-test-"));
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(phase01Worktree, { recursive: true });
    await writeFile(join(phase01Worktree, "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("emits the expected trace event sequence for a one-phase run", async () => {
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

    const fakeTracer = makeFakeTracer();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      fakeTracer.layer,
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

    const names = fakeTracer.impl.eventNames();
    // Config + run start
    expect(names).toContain("config.discovered");
    expect(names).toContain("config.validated");
    // Phase lifecycle
    expect(names).toContain("git.worktree.created");
    expect(names).toContain("agent.invocation.started");
    expect(names).toContain("agent.invocation.completed");
    expect(names).toContain("agent.session.captured");
    expect(names).toContain("gate.started");
    expect(names).toContain("gate.completed");
    expect(names).toContain("handoff.requested");
    expect(names).toContain("handoff.validated");
    expect(names).toContain("git.commit.created");

    // Ordering: invocation precedes gates precede commit.
    expect(names.indexOf("agent.invocation.started")).toBeLessThan(names.indexOf("gate.started"));
    expect(names.indexOf("gate.completed")).toBeLessThan(names.indexOf("git.commit.created"));

    // Every event carries the run short name and a valid timestamp.
    for (const e of fakeTracer.impl.events) {
      expect(e.run).toBe("my-run");
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false);
    }

    // Snapshot the full ordered event sequence for the trace contract.
    const eventSequence = fakeTracer.impl.events.map((e) => ({
      event: e.event,
      status: e.status,
      phase: e.phase,
      boundary: e.boundary,
      details: sanitizeDetails(e.details),
    }));
    expect(eventSequence).toMatchSnapshot("trace-event-sequence");
  });
});
