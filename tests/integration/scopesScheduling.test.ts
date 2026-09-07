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
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: ["src/core/billing/port.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): add port", body: "Adds the billing port." },
    },
    {
      id: "phase-02",
      title: "Second Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-02-second",
      plannedFilesToCreate: [],
      plannedFilesToEdit: ["src/core/billing/invoice.ts"],
      optionalFilesToEdit: ["src/index.ts"],
      commit: { subject: "ai(phase-02): wire invoice", body: "Wires the invoice." },
    },
    {
      id: "phase-03",
      title: "Third Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-03-third",
      plannedFilesToCreate: ["src/adapters/billing/stripe.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-03): add stripe adapter", body: "Adds the stripe adapter." },
    },
  ],
} as const;

describe("executePlan — scope provider scheduling end to end", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-scopes-scheduling-test-"));
    for (const phaseId of ["phase-01", "phase-02", "phase-03"]) {
      const worktree = join(stateRoot, "worktrees", "test-project.my-run", phaseId);
      await mkdir(join(worktree, ".phax-context"), { recursive: true });
      await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
    }
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("queries the scope provider with exactly the projected phases at each non-terminal gate, never at the terminal phase", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: {
          standard: [
            {
              command: "pnpm audit",
              surface: "local",
              firing: "every-phase",
              output: "diagnostics",
            },
          ],
        },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      namespace: "test-project",
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,
      records: {
        enabled: false,
        transcript: false,
        destination: { kind: "in-repo" as const },
        autoPush: false,
      },
      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
      scopes: { command: "scopes-provider" },
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    const phase02WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-02");
    const phase03WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-03");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false, true);
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false, true);
    fakeGit.impl.enqueueWorktreeIsClean(phase03WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("pnpm audit", {
      exitCode: 0,
      stdout: JSON.stringify({ diagnostics: [] }),
      stderr: "",
    });
    fakeShell.impl.setResponse("scopes-provider", {
      exitCode: 0,
      stdout: JSON.stringify({ closed: [] }),
      stderr: "",
    });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    for (const sessionId of ["sess-01", "sess-02", "sess-03"]) {
      fakeBackend.impl.addRunResponse({
        sessionId: sessionId as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
    }
    for (const sessionId of ["sess-01-handoff", "sess-02-handoff", "sess-03-handoff"]) {
      fakeBackend.impl.addResumeResponse({
        sessionId: sessionId as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
    }

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

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
          gateProfileId: "standard",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const providerCalls = fakeShell.impl.calls.filter((c) => c.command[0] === "scopes-provider");
    expect(providerCalls).toHaveLength(2);

    const phase02Request = JSON.parse(providerCalls[1]!.stdin ?? "{}") as unknown;
    expect(phase02Request).toEqual({
      phase: "phase-02",
      phases: [
        { id: "phase-01", files: ["src/core/billing/port.ts"] },
        { id: "phase-02", files: ["src/core/billing/invoice.ts"] },
        { id: "phase-03", files: ["src/adapters/billing/stripe.ts"] },
      ],
    });
    expect(Object.keys(phase02Request as object)).toEqual(["phase", "phases"]);
    for (const projectedPhase of (
      phase02Request as { phases: readonly { id: string; files: readonly string[] }[] }
    ).phases) {
      expect(Object.keys(projectedPhase)).toEqual(["id", "files"]);
    }
  });
});
