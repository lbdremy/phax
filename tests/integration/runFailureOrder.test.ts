import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  renderSessionFailure,
  splitFollowUps,
} from "../../src/cli/commands/sessionFailureOutput.js";
import { decodeShortName, type ClaudeSessionId } from "../../src/domain/branded.js";
import { AgentSessionFailedError, FailureWithFollowUpsError } from "../../src/domain/errors.js";
import { readClaudeOutcome } from "../../src/domain/session/outcome.js";
import type { SessionFailure } from "../../src/domain/session/outcome.js";
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
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";

// A run whose phase's fix turn fails with a provider error, records on with
// transcripts and an in-repo destination, and a GitHub whose visibility
// fails: the record refusal does not reach stderr ahead of the failure, it
// rides on the error and the CLI prints the failure line first.

const GH_LINE = "error connecting to api.github.com";

let stateRoot: string;

beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "phax-run-failure-order-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(stateRoot, { recursive: true, force: true });
});

function providerError(): SessionFailure {
  const outcome = readClaudeOutcome({
    lines: [
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "API Error: 500 Internal server error",
      }),
    ],
    stderr: "",
    end: { kind: "exited", code: 1 },
  });
  if (outcome.kind !== "failure") throw new Error("the error must read as a failure");
  return outcome.failure;
}

describe("a failed phase session and its refused record", { timeout: 30_000 }, () => {
  it("hands the refusal to the CLI after the failure, and exits with the failure's code", async () => {
    const failure = providerError();
    expect(failure.kind).toBe("provider-error");
    const worktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });

    const plan = Either.getOrThrow(
      liftFixturePhaxPlanToCurrent("phax-plan.json", {
        version: 1,
        run: { shortName: "my-run", title: "My Run", branch: "ai/my-run", requiredCommands: [] },
        phases: [
          {
            id: "phase-01",
            title: "First Phase",
            model: "claude-sonnet-4-6",
            effort: "low" as const,
            planMarkdownAnchor: "#phase-01",
            plannedFilesToCreate: [],
            plannedFilesToEdit: [],
            optionalFilesToEdit: [],
            commit: { subject: "feat: add thing", body: "Adds the thing." },
          },
        ],
      }),
    ).plan;

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        name: "test-project",
        state: { root: stateRoot },
        gateProfiles: {
          full: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
        },
        commands: {},
      },
      stateRoot,
      namespace: "test-project",
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,
      records: {
        enabled: true,
        transcript: true,
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
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);

    const fakeShell = makeFakeShell();
    // The gate fails, so the phase's session is resumed to fix it.
    fakeShell.impl.setResponse("true", { exitCode: 1, stdout: "", stderr: "red" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "cafebabe\n",
      stderr: "",
    });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.failResumeWith(0, failure, {
      agentErrorLog: "/runs/r/phase-01/agent-error.log",
      transcript: "/runs/r/phase-01/output.jsonl",
    });

    const fakeGitHub = makeFakeGitHub();
    fakeGitHub.impl.failVisibility(GH_LINE);

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      fakeGitHub.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const shortName = Either.getOrThrow(decodeShortName("my-run"));
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, config).pipe(Effect.provide(layers)),
    );

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          phaxVersion: "0.0.0-test",
          shortName,
          namespace: "test-project",
          plan,
          planMd: planMdFor(plan),
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left).toBeInstanceOf(FailureWithFollowUpsError);
    expect(exitCodeForError(result.left)).toBe(5);

    // The refusal never reached stderr ahead of the failure.
    const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(written).not.toContain("records destination refused");

    const { cause, followUps } = splitFollowUps(result.left);
    expect(cause).toBeInstanceOf(AgentSessionFailedError);
    const printed = [
      ...renderSessionFailure(cause as AgentSessionFailedError, null),
      ...followUps.map((line) => `warn: ${line}`),
    ];
    expect(printed[0]).toContain("session failed (provider-error)");
    const refusal = printed.findIndex((line) =>
      line.startsWith("warn: phase record refused, following the failed session"),
    );
    expect(refusal).toBeGreaterThan(0);
    expect(printed[refusal]).toContain(`gh: ${GH_LINE}`);
    expect(printed[refusal]).toContain("retry once the network is back");
  });
});
