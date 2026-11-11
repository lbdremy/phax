import { Effect, Result, Layer } from "effect";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
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
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { processOutput } from "../helpers/processOutput.js";

// ac-never-run: phax shows partial commands and allows their prefixes, but
// never executes one. The harness is the fake shell (the gate integration
// tests' harness): the executed list is its recorded calls, and a partial
// command that ran would also show up there.

const shortName = Result.getOrThrow(decodeShortName("my-run"));

const STEPS: readonly GateStep[] = [
  {
    command: "pnpm lint",
    surface: "local",
    firing: "every-phase",
    output: "log",
    partial: {
      files: "touch .ran-files <files>",
      diff: "git diff --name-only | xargs touch .ran-diff",
    },
  },
  {
    command: "pnpm test",
    surface: "local",
    firing: "every-phase",
    output: "log",
    partial: { files: "touch .ran-test <files>" },
  },
];
const STEP_COMMANDS = STEPS.map((s) => s.command);

function session(id: string) {
  return {
    sessionId: id as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  };
}

describe("partial commands are never run", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "phax-partial-never-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("ac-never-run: a failing then fixed gate executes only the step commands, in order", async () => {
    const rawPlan = {
      version: 1,
      run: { shortName: "my-run", title: "My Run", branch: "ai/my-run", requiredCommands: [] },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          model: "claude-sonnet-4-6",
          effort: "low" as const,
          planMarkdownAnchor: "#phase-01-work",
          plannedFilesToCreate: ["src/new-1.ts"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "ai(phase-01): step 1", body: "Does step 1." },
        },
      ],
    };
    const plan = Result.getOrThrow(liftFixturePhaxPlanToCurrent("phax-plan.json", rawPlan)).plan;
    const planMd = planMdFor(rawPlan);
    const worktree = join(root, "worktrees", "test-project.my-run", "phase-01");
    await mkdir(join(worktree, ".phax-context"), { recursive: true });
    await writeFile(
      join(worktree, ".phax-context", "phase-handoff.md"),
      [
        "## What was delivered",
        "Done.",
        "## Key decisions and why",
        "None.",
        "## Exact locations (file paths and exported names)",
        "None.",
        "## What the next phase needs to know",
        "Nothing.",
      ].join("\n"),
    );

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        name: "test-project",
        state: { root },
        gateProfiles: { full: STEPS as never },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot: root,
      namespace: "test-project",
      repoRoot: root,
      maxFixAttempts: 2,
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
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
      publish: resolvePublishConfig(undefined),
      complianceReview: resolveComplianceReviewConfig(undefined),
      codeReview: resolveCodeReviewConfig(undefined),
      authoring: resolveAuthoringConfig(undefined),
    };

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktree, false);

    // `pnpm test` fails on its first run and passes after the fix attempt.
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    const baseRun = fakeShell.impl.run.bind(fakeShell.impl);
    let testRuns = 0;
    fakeShell.impl.run = (options) => {
      if (options.command.join(" ") === "pnpm test") {
        testRuns += 1;
        fakeShell.impl.setResponse("pnpm test", {
          exitCode: testRuns === 1 ? 1 : 0,
          stdout: "",
          stderr: testRuns === 1 ? "red" : "",
        });
      }
      return baseRun(options);
    };

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse(session("sess-01"));
    for (const id of ["sess-01-fix", "sess-01-h"]) fakeBackend.impl.addResumeResponse(session(id));

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
      makeFakeGitHub().layer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(layers)),
    );
    const result = await Effect.runPromise(
      Effect.result(
        executePlan({
          phaxVersion: "0.0.0-test",
          output: processOutput,
          shortName,
          namespace: "test-project",
          plan,
          planMd,
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ _tag: "Success" });

    // The gate failed once and ran again after the fix attempt.
    expect(testRuns).toBe(2);
    const executed = fakeShell.impl.calls.map((c) => c.command.join(" "));
    expect(executed.filter((c) => /touch|xargs|<files>/.test(c))).toEqual([]);
    expect(executed.filter((c) => STEP_COMMANDS.includes(c))).toEqual([
      "pnpm lint",
      "pnpm test",
      "pnpm lint",
      "pnpm test",
    ]);

    for (const dir of [worktree, root]) {
      const names = await readdir(dir);
      expect(names.filter((n) => n.startsWith(".ran-"))).toEqual([]);
    }
  });
});
