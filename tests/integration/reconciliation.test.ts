import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import type { ReconciliationResult } from "../../src/domain/reconciliation/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Phase completed.",
  "## Key decisions and why",
  "None.",
  "## Exact locations (file paths and exported names)",
  "None.",
  "## What the next phase needs to know",
  "Proceed.",
].join("\n");

const shortName = Either.getOrThrow(decodeShortName("recon-run"));

const rawPlan = {
  version: 1,
  run: {
    shortName: "recon-run",
    title: "Reconciliation Run",
    branch: "ai/recon-run",
    backend: "claude-code-cli",
  },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: ["src/new-file.ts"],
      plannedFilesToEdit: ["src/existing.ts"],
      optionalFilesToEdit: ["src/optional.ts"],
      commit: { subject: "feat: do thing", body: "Does the thing." },
    },
  ],
} as const;

describe("reconcilePhaseFiles — lifecycle wiring", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-recon-test-"));
    const phase01Worktree = join(stateRoot, "worktrees", "recon-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("writes file-reconciliation.json and .md with correct classification", async () => {
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
      fileReconciliationMode: "report_only" as const,

      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
      },
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "recon-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    // dirty for commitPhase (final phase — no cleanupPhase call)
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);
    // Enqueue name-status entries that produce a mix of planned/unplanned changes
    fakeGit.impl.enqueueDiffNameStatus(phase01WorktreePath, [
      { status: "added", path: "src/new-file.ts" }, // planned create — hit
      { status: "modified", path: "src/existing.ts" }, // planned edit — hit
      { status: "added", path: "src/unplanned.ts" }, // unplanned create — deviation
      // src/optional.ts not touched — fine (no deviation)
    ]);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "abc123\n",
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

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Recon Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# Recon Plan",
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

    const jsonPath = join(runPath, "phase-01", "file-reconciliation.json");
    const mdPath = join(runPath, "phase-01", "file-reconciliation.md");

    const jsonContent = JSON.parse(await readFile(jsonPath, "utf8")) as ReconciliationResult;
    expect(jsonContent.createdAsPlanned).toEqual(["src/new-file.ts"]);
    expect(jsonContent.editedAsPlanned).toEqual(["src/existing.ts"]);
    expect(jsonContent.missingPlannedCreate).toEqual([]);
    expect(jsonContent.missingPlannedEdit).toEqual([]);
    expect(jsonContent.unplannedCreated).toEqual(["src/unplanned.ts"]);
    expect(jsonContent.unplannedEdited).toEqual([]);
    expect(jsonContent.optionalTouched).toEqual([]);
    expect(jsonContent.hasDeviations).toBe(true);

    const mdContent = await readFile(mdPath, "utf8");
    expect(mdContent).toContain("## PHAX File Reconciliation");
    expect(mdContent).toContain("src/new-file.ts");
    expect(mdContent).toContain("src/unplanned.ts");
    expect(mdContent).toContain("Deviation");
    expect(mdContent).toContain("Deviations detected");
  });

  it("writes no-deviation report when actual changes match planned exactly", async () => {
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
      fileReconciliationMode: "report_only" as const,

      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
      },
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "recon-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);
    // Exactly planned: one create, one edit, no extras
    fakeGit.impl.enqueueDiffNameStatus(phase01WorktreePath, [
      { status: "added", path: "src/new-file.ts" },
      { status: "modified", path: "src/existing.ts" },
    ]);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "def456\n",
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

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# Recon Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# Recon Plan",
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

    const jsonContent = JSON.parse(
      await readFile(join(runPath, "phase-01", "file-reconciliation.json"), "utf8"),
    ) as ReconciliationResult;
    expect(jsonContent.hasDeviations).toBe(false);

    const mdContent = await readFile(join(runPath, "phase-01", "file-reconciliation.md"), "utf8");
    expect(mdContent).toContain("No deviations");
  });
});
