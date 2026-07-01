import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { SecurityPreflightError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
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

const shortName = Either.getOrThrow(decodeShortName("my-run"));

function makeMinimalConfig(
  stateRoot: string,
  overrides?: {
    allowWriteProtected?: readonly string[];
    profile?: "secure" | "unsafe" | "isolated";
  },
): ResolvedConfig {
  return {
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root: stateRoot },
      gateProfiles: { full: ["true"] },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot,
    namespace: "test-project",
    repoRoot: stateRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      profile: overrides?.profile ?? "unsafe",
      filesystem: {
        allowRead: [],
        allowWrite: [],
        allowWriteProtected: overrides?.allowWriteProtected ?? [],
      },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
  };
}

function makeLayers(stateRoot: string, sessionId: string) {
  const phase01Worktree = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  fakeGit.impl.enqueueWorktreeIsClean(phase01Worktree, false);

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
    sessionId: sessionId as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  });
  fakeBackend.impl.addResumeResponse({
    sessionId: `${sessionId}-handoff` as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  });

  return {
    layers: Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    ),
    fakeBackend,
    phase01Worktree,
  };
}

describe("executePlan — protected-path approvals", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-protected-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("passes approvedProtectedPaths to runAgent when phase declares covered protected file", async () => {
    const phase01Worktree = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    const { layers, fakeBackend } = makeLayers(stateRoot, "sess-01");
    // Pre-create worktree handoff so generatePhaseHandoff can find it.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);

    const rawPlan = {
      version: 1 as const,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "ai/my-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "claude-sonnet-4-6",
          effort: "low" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [".claude/skills/my-skill/SKILL.md"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "ai(phase-01): add skill", body: "Adds the skill." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeMinimalConfig(stateRoot, {
      allowWriteProtected: [".claude/skills/"],
    });

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
          // Use secure mode so the policy carries allowWriteProtected from config
          // and the approval is actually computed and passed through.
          securityMode: "secure",
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    const call = fakeBackend.impl.runCalls[0]!;
    const approved = call.options.approvedProtectedPaths;
    expect(approved).toBeDefined();
    expect(approved).toHaveLength(1);
    // The approved path must be absolute and end with the repo-relative path.
    expect(approved![0]).toContain(".claude/skills/my-skill/SKILL.md");
    expect(approved![0]!.startsWith("/")).toBe(true);
  });

  it("fails preflight with SecurityPreflightError when phase declares protected path not opted in", async () => {
    const rawPlan = {
      version: 1 as const,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "ai/my-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "claude-sonnet-4-6",
          effort: "low" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [".claude/skills/my-skill/SKILL.md"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "ai(phase-01): add skill", body: "Adds the skill." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    // allowWriteProtected is empty — operator has NOT opted in.
    const config = makeMinimalConfig(stateRoot, { allowWriteProtected: [] });

    const phase01Worktree = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    const { layers, fakeBackend } = makeLayers(stateRoot, "sess-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
          // Use secure mode so the preflight check runs (it only runs in secure mode).
          securityMode: "secure",
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SecurityPreflightError);
      const err = result.left as SecurityPreflightError;
      expect(err.message).toContain("phase-01");
      expect(err.message).toContain("allowWriteProtected");
      expect(err.missing).toContain(".claude/skills/my-skill/SKILL.md");
    }
    // Backend must never be called — preflight rejects before spawn.
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });

  it("passes empty approvedProtectedPaths when phase declares only non-protected files", async () => {
    const phase01Worktree = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);

    const rawPlan = {
      version: 1 as const,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "ai/my-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "claude-sonnet-4-6",
          effort: "low" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: ["src/foo.ts"],
          plannedFilesToEdit: ["src/bar.ts"],
          optionalFilesToEdit: ["README.md"],
          commit: { subject: "ai(phase-01): normal changes", body: "Normal phase." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    // No allowWriteProtected needed — no protected paths declared.
    const config = makeMinimalConfig(stateRoot, { allowWriteProtected: [] });
    const { layers, fakeBackend } = makeLayers(stateRoot, "sess-01");

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
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
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    const call = fakeBackend.impl.runCalls[0]!;
    // No protected paths → empty (or undefined) approvedProtectedPaths.
    const approved = call.options.approvedProtectedPaths;
    expect(approved === undefined || approved.length === 0).toBe(true);
  });
});
