// The headless code review at run end (spec headless-code-review §5.20–§5.26):
// with review.code.enabled on, a run that reaches review_open reviews its change
// after the compliance review and before the pull request, and a review that
// goes wrong never fails the run. Drives executePlan with fake ports; nothing
// reaches GitHub: every test uses makeFakeGitHub().
import { Effect, Either, Layer } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";

const COMPLIANCE_JSON = JSON.stringify({
  version: 1,
  verdict: "conformant",
  summary: "All phases conformed.",
  perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [] }],
  attentionPoints: [],
  pointers: [],
});

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

const NAMESPACE = "test-project";
const SHORT_NAME = "code-review-run";
const GATE = "node scripts/example-check.mjs";
const shortName = Either.getOrThrow(decodeShortName(SHORT_NAME));

const RECORDS: ResolvedRecordsConfig = {
  enabled: true,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const finding = (overrides: Record<string, unknown> = {}) => ({
  severity: "bug",
  file: "src/a.ts",
  line: 12,
  message: "The flag is ignored.",
  lens: "surface",
  escape: "wrong-oracle",
  criterion: "ac-1",
  suggestion: "Read the flag.",
  ...overrides,
});

const answerOf = (...findings: unknown[]) => JSON.stringify({ version: 1, findings });

const HEADING = "### Code review findings";

async function runState(runPath: string): Promise<string | undefined> {
  const status = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
    readonly state?: string;
  };
  return status.state;
}

type CodeReviewConfig = ReturnType<typeof resolveCodeReviewConfig>;

describe("headless code review at run end", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-code-review-run-end-"));
    await mkdir(join(worktreeOf(), ".phax-context"), { recursive: true });
    await writeFile(join(worktreeOf(), ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(stateRoot, { recursive: true, force: true });
  });

  function worktreeOf(): string {
    return join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-01");
  }

  function makeConfig(codeReview: CodeReviewConfig): ResolvedConfig {
    return {
      raw: {
        version: 1,
        name: NAMESPACE,
        state: { root: stateRoot },
        gateProfiles: {
          full: [{ command: GATE, surface: "local", firing: "every-phase", output: "log" }],
        },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      namespace: NAMESPACE,
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,
      records: RECORDS,
      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only" },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
      publish: resolvePublishConfig({ auto: true }),
      complianceReview: { enabled: true, model: "claude-sonnet-5", effort: "medium" },
      codeReview,
      authoring: resolveAuthoringConfig(undefined),
    };
  }

  /**
   * One run with the compliance review, the code review and publish.auto on.
   * `answer` is the code review session's final message (none when undefined);
   * `codeSession` false queues no response for it, so that session fails.
   */
  async function runOnce(
    opts: {
      readonly codeReview?: CodeReviewConfig;
      readonly answer?: string;
      readonly codeSession?: boolean;
      /** Call executePlan without `bundledReviewSkill`. */
      readonly withoutSkill?: boolean;
      readonly onCodeReview?: (git: ReturnType<typeof makeFakeGit>) => void;
    } = {},
  ) {
    const plan = Either.getOrThrow(
      liftFixturePhaxPlanToCurrent("phax-plan.json", {
        version: 1,
        run: {
          shortName: SHORT_NAME,
          title: "Code Review Run",
          branch: "ai/code-review-run",
          requiredCommands: [],
        },
        phases: [
          {
            id: "phase-01",
            title: "First Phase",
            model: "claude-opus-5-5",
            effort: "low" as const,
            planMarkdownAnchor: "#phase-01-first",
            plannedFilesToCreate: [],
            plannedFilesToEdit: [],
            optionalFilesToEdit: [],
            commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
          },
        ],
      }),
    ).plan;
    const config = makeConfig(
      opts.codeReview ?? { ...resolveCodeReviewConfig(undefined), enabled: true },
    );

    const git = makeFakeGit();
    git.impl.setRepoIsClean(true);
    git.impl.addExistingRemote("origin");
    git.impl.enqueueWorktreeIsClean(worktreeOf(), false);
    const github = makeFakeGitHub();
    const shell = makeFakeShell();
    shell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    shell.impl.setResponse(GATE, { exitCode: 0, stdout: "ok", stderr: "" });
    shell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    shell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const sessions: string[] = [];
    const atCodeReviewStart: { complianceJson: boolean; pullRequests: number }[] = [];
    const codeCalls: { model: string; effort: string }[] = [];
    const backend = makeFakeBackend();
    backend.impl.setOnRunAgent((_prompt, options) => {
      const stream = options.outputJsonlPath ?? "";
      const context = join(worktreeOf(), ".phax-context");
      mkdirSync(context, { recursive: true });
      if (stream.endsWith("compliance-review.session.jsonl")) {
        sessions.push("compliance");
        writeFileSync(join(context, "compliance-review.md"), "# Compliance Review\n");
        writeFileSync(join(context, "compliance-review.json"), COMPLIANCE_JSON);
      } else if (stream.endsWith("code-review.session.jsonl")) {
        sessions.push("code-review");
        codeCalls.push({ model: options.model, effort: options.effort });
        atCodeReviewStart.push({
          complianceJson: existsSync(join(runPathOf(), "compliance-review.json")),
          pullRequests: github.impl.calls.filter((c) => c.method === "createPullRequest").length,
        });
        opts.onCodeReview?.(git);
      }
    });
    const responses: [string, string][] = [
      ["session-phase-01", ""],
      ["session-compliance", ""],
    ];
    // The code review answers with its final message.
    if (opts.codeSession !== false) responses.push(["session-code-review", opts.answer ?? ""]);
    for (const [sessionId, finalText] of responses) {
      backend.impl.addRunResponse({
        sessionId: sessionId as ClaudeSessionId,
        outputPath: "",
        finalText,
      });
    }
    backend.impl.addResumeResponse({
      sessionId: "session-phase-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    const layers = Layer.mergeAll(
      git.layer,
      shell.layer,
      backend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
      github.layer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, config).pipe(Effect.provide(layers)),
    );
    currentRunPath = runPath;
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const outcome = await Effect.runPromise(
      Effect.either(
        executePlan({
          phaxVersion: "0.0.0-test",
          shortName,
          namespace: NAMESPACE,
          plan,
          planMd: planMdFor(plan),
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
          ...(opts.withoutSkill === true ? {} : { bundledReviewSkill: "# Bundled doctrine\n" }),
        }).pipe(Effect.provide(layers)),
      ),
    );
    const prBodyPath = join(runPath, "pr-body.md");
    return {
      git,
      github,
      runPath,
      runId: runId as string,
      outcome,
      sessions,
      atCodeReviewStart,
      codeCalls,
      stderr: stderr.join(""),
      prBody: existsSync(prBodyPath) ? readFileSync(prBodyPath, "utf8") : undefined,
      pullRequests: github.impl.calls.filter((c) => c.method === "createPullRequest").length,
    };
  }

  let currentRunPath = "";
  const runPathOf = () => currentRunPath;

  it("runs the session after compliance-review.json and before the pull request, and lists the findings", async () => {
    const r = await runOnce({ answer: answerOf(finding()) });

    expect(Either.isRight(r.outcome)).toBe(true);
    expect(r.sessions).toEqual(["compliance", "code-review"]);
    expect(r.atCodeReviewStart).toEqual([{ complianceJson: true, pullRequests: 0 }]);
    expect(r.pullRequests).toBe(1);
    expect(existsSync(join(r.runPath, "code-review.json"))).toBe(true);
    expect(existsSync(join(r.runPath, "code-review-session.json"))).toBe(true);
    expect(r.prBody).toContain(HEADING);
    expect(r.prBody).toContain("`src/a.ts:12` — The flag is ignored.");
    expect(await runState(r.runPath)).toBe("review_open");
  });

  it("runs no session, writes no file and leaves the heading out when review.code holds only model and effort", async () => {
    const r = await runOnce({
      codeReview: resolveCodeReviewConfig({ model: "claude-sonnet-5-5", effort: "medium" }),
      answer: answerOf(finding()),
    });

    expect(Either.isRight(r.outcome)).toBe(true);
    expect(r.sessions).toEqual(["compliance"]);
    expect(existsSync(join(r.runPath, "code-review.json"))).toBe(false);
    expect(r.prBody).toBeDefined();
    expect(r.prBody).not.toContain(HEADING);
    expect(r.stderr).not.toContain("code review");
  });

  it.each([
    ["the lens security", answerOf(finding({ lens: "security" }))],
    ["a missing suggestion", answerOf((({ suggestion: _s, ...rest }) => rest)(finding()))],
    ["the unknown key confidence", answerOf(finding({ confidence: 0.9 }))],
    ["text that is not JSON", "this is not json"],
  ])(
    "keeps %s out of the records and the description, and the run review_open",
    async (_n, answer) => {
      const r = await runOnce({ answer });

      expect(Either.isRight(r.outcome)).toBe(true);
      expect(existsSync(join(r.runPath, "code-review.json"))).toBe(false);
      expect(existsSync(join(r.runPath, "code-review-session.json"))).toBe(false);
      expect(await runState(r.runPath)).toBe("review_open");
      expect(r.prBody).not.toContain(HEADING);
      expect(r.stderr).toContain("[phax] Warning: code review failed: ");
      expect(r.stderr).toContain(`phax review-code ${SHORT_NAME} --headless`);
    },
  );

  it("leaves the run review_open, the pull request written and neither review file when the session fails", async () => {
    const r = await runOnce({ codeSession: false });

    expect(Either.isRight(r.outcome)).toBe(true);
    expect(await runState(r.runPath)).toBe("review_open");
    expect(r.pullRequests).toBe(1);
    expect(existsSync(join(r.runPath, "code-review.json"))).toBe(false);
    expect(existsSync(join(r.runPath, "code-review-session.json"))).toBe(false);
    expect(r.stderr).toContain("[phax] Warning: code review failed: ");
    expect(r.prBody).not.toContain(HEADING);
  });

  it("runs the session on the configured model and effort", async () => {
    const r = await runOnce({
      codeReview: resolveCodeReviewConfig({
        enabled: true,
        model: "claude-sonnet-5-5",
        effort: "medium",
      }),
      answer: answerOf(),
    });

    expect(r.codeCalls).toEqual([{ model: "claude-sonnet-5-5", effort: "medium" }]);
    expect(r.prBody).toContain(`${HEADING}`);
    expect(r.prBody).toContain("None.");
  });

  it("skips the review with a warning when the bundled skill was not given", async () => {
    const r = await runOnce({ withoutSkill: true, answer: answerOf(finding()) });

    expect(Either.isRight(r.outcome)).toBe(true);
    expect(r.sessions).toEqual(["compliance"]);
    expect(r.stderr).toContain(
      "[phax] Warning: code review not run: the bundled phax-review skill was not given",
    );
    expect(r.pullRequests).toBe(1);
  });

  it("keeps code-review.json, the run review_open and warns of the pending entry when the records commit fails", async () => {
    const r = await runOnce({
      answer: answerOf(finding()),
      onCodeReview: (git) => git.impl.failNextWriteTreeCommit("disk full"),
    });

    expect(Either.isRight(r.outcome)).toBe(true);
    expect(existsSync(join(r.runPath, "code-review.json"))).toBe(true);
    expect(await runState(r.runPath)).toBe("review_open");
    expect(r.stderr).toContain("[phax] Warning: the code-review entry was not committed");
    expect(r.stderr).toContain("it is pending");
    expect(r.prBody).toContain(HEADING);
  });
});
