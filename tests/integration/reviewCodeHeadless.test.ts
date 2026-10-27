// The headless code review (spec headless-code-review §5.20–§5.22): one session
// under the compliance review's posture answers in .phax-context/code-review.json;
// an accepted answer becomes code-review.json and the run's review session, any
// other outcome writes neither. Driven through the use case with the fake file
// system, backend, git and GitHub.
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { reviewCodeAndRecord, reviewCodeHeadless } from "../../src/app/reviewCode.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import { resolveReviewSecurityPolicy } from "../../src/domain/security/resolveReviewPolicy.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

const stateRoot = "/fake-state";
const runPath = `${stateRoot}/runs/my-run`;
const worktreePath = "/fake/worktrees/my-run--phase-01";
const answerPath = `${worktreePath}/.phax-context/code-review.json`;
const reviewPath = `${runPath}/code-review.json`;
const sessionPath = `${runPath}/code-review-session.json`;
const streamPath = `${runPath}/code-review.session.jsonl`;
const nowIso = "2026-10-27T12:00:00.000Z";
const bundledReviewSkill = "---\nname: phax-review\n---\n\n# Bundled doctrine\n";

const info: RunReviewInfo = {
  namespace: "test-project",
  shortName: "my-run",
  runId: "my-run-001",
  runState: "review_open",
  branch: "feature/my-run",
  runTitle: "My Run",
  finalPhaseBranch: "feature/my-run--phase-01" as BranchName,
  stateRoot,
  runPath,
  finalPhaseId: "phase-01",
  finalPhaseTitle: "Phase 01",
  worktreePath,
  claudeSessionId: undefined,
  gateProfileId: "full",
  phaseStatuses: [],
  planPhases: [{ id: "phase-01", title: "Phase 01" }],
  updatedAt: "2026-10-27T11:00:00.000Z",
  stoppedReason: undefined,
  lastError: undefined,
};

const config = { enabled: false, model: "claude-opus-5-5", effort: "high" } as const;

function resolutionOn(provider: "claude-code" | "codex-cli"): RoutingResolution {
  return {
    requested: { model: "claude-opus-5-5", family: "claude-opus", effort: "high" },
    selected: {
      provider,
      family: "claude-opus",
      concreteModel: "claude-opus-5-5",
      thinking: "high",
    },
    relationship: "exact",
    reason: "exact match",
  };
}

const security = {
  mode: "secure" as const,
  config: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  } satisfies ResolvedSecurityConfig,
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

const CLAUDE_STREAM = [
  JSON.stringify({ type: "system", subtype: "init", session_id: "session-a" }),
  JSON.stringify({
    type: "result",
    session_id: "session-a",
    duration_ms: 900,
    modelUsage: { "claude-opus-5-5": { inputTokens: 10, outputTokens: 20, costUSD: 0.5 } },
  }),
].join("\n");

function setup() {
  const fs = makeFakeFileSystem();
  const backend = makeFakeBackend();
  const git = makeFakeGit();
  const github = makeFakeGitHub();
  const layer = Layer.mergeAll(
    fs.layer,
    backend.layer,
    git.layer,
    github.layer,
    NoopSystemTelemetryLayer,
  );
  /** The next session: writes `answer` (when given) and returns `sessionId`. */
  const session = (sessionId: string, answer: string | undefined, stream?: string) => {
    backend.impl.setOnRunAgent((_prompt, options) => {
      if (answer !== undefined) fs.impl.setFile(answerPath, answer);
      if (stream !== undefined) fs.impl.setFile(options.outputJsonlPath ?? streamPath, stream);
    });
    backend.impl.addRunResponse({
      sessionId: sessionId as ClaudeSessionId,
      outputPath: streamPath,
      finalText: "",
    });
  };
  const review = (provider: "claude-code" | "codex-cli" = "claude-code") =>
    Effect.runPromise(
      reviewCodeHeadless(info, config, resolutionOn(provider), security, {
        bundledReviewSkill,
        nowIso,
      }).pipe(Effect.provide(layer)),
    );
  return { fs, backend, git, github, layer, session, review };
}

describe("reviewCodeHeadless", () => {
  it("writes code-review.json in the answer's order and the session that ran the review", async () => {
    const t = setup();
    t.session("session-a", answerOf(finding(), finding({ severity: "info", line: 3 })));

    const result = await t.review();

    expect(result.kind).toBe("accepted");
    const file = JSON.parse(t.fs.impl.getFile(reviewPath) ?? "") as {
      $schema: string;
      findings: ReadonlyArray<{ severity: string }>;
    };
    expect(Object.keys(file)).toEqual(["$schema", "findings"]);
    expect(file.$schema).toMatch(/\/code-review\//);
    expect(file.findings.map((f) => f.severity)).toEqual(["bug", "info"]);
    expect(JSON.parse(t.fs.impl.getFile(sessionPath) ?? "")).toEqual({
      version: 1,
      shortName: "my-run",
      runId: "my-run-001",
      provider: "claude-code",
      sessionId: "session-a",
      worktreePath,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  it("records the provider the routing resolution selected", async () => {
    const t = setup();
    t.session("session-x", answerOf());

    await t.review("codex-cli");

    expect(JSON.parse(t.fs.impl.getFile(sessionPath) ?? "").provider).toBe("codex-cli");
    expect(t.backend.impl.runCalls[0]?.options.provider).toBe("codex-cli");
  });

  it.each([
    ["a refused answer", answerOf(finding({ lens: "everything" })), /^answer refused: .*lens/],
    ["text that is not JSON", "not json at all", /^answer refused: not JSON/],
    [
      "a session that wrote no answer",
      undefined,
      new RegExp(`^the session wrote no answer at ${answerPath}`),
    ],
  ])(
    "%s fails with its reason and leaves both files as they were",
    async (_name, answer, reason) => {
      const t = setup();
      t.fs.impl.setFile(reviewPath, "previous review");
      t.fs.impl.setFile(sessionPath, "previous session");
      t.session("session-b", answer);

      const result = await t.review();

      expect(result.kind).toBe("failed");
      if (result.kind !== "failed") return;
      expect(result.reason).toMatch(reason);
      expect(t.fs.impl.getFile(reviewPath)).toBe("previous review");
      expect(t.fs.impl.getFile(sessionPath)).toBe("previous session");
    },
  );

  it("a failed session says so and writes neither file on a run with no review files", async () => {
    const t = setup();
    // No queued response: the fake backend fails the call.
    const result = await t.review();

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toMatch(/^the session failed: /);
    expect(t.fs.impl.getFile(reviewPath)).toBeUndefined();
    expect(t.fs.impl.getFile(sessionPath)).toBeUndefined();
  });

  it("a second accepted review replaces both files with only its own", async () => {
    const t = setup();
    t.session("session-1", answerOf(finding({ message: "first" })));
    await t.review();
    t.session("session-2", answerOf(finding({ message: "second" })));
    await t.review();

    const file = JSON.parse(t.fs.impl.getFile(reviewPath) ?? "") as {
      findings: ReadonlyArray<{ message: string }>;
    };
    expect(file.findings.map((f) => f.message)).toEqual(["second"]);
    expect(JSON.parse(t.fs.impl.getFile(sessionPath) ?? "").sessionId).toBe("session-2");
  });

  it("removes an answer left by an earlier invocation before the session starts", async () => {
    const t = setup();
    t.fs.impl.setFile(answerPath, answerOf(finding({ message: "stale" })));
    t.session("session-c", undefined);

    const result = await t.review();

    expect(result.kind).toBe("failed");
    expect(t.fs.impl.getFile(reviewPath)).toBeUndefined();
  });

  it("carries the bundled doctrine, the closed ids and the answer path", async () => {
    const t = setup();
    t.session("session-d", answerOf());

    await t.review();

    const prompt = t.backend.impl.runCalls[0]?.prompt ?? "";
    expect(prompt).toContain("Bundled doctrine");
    expect(prompt).toContain("(bundled)");
    expect(prompt).toContain(answerPath);
    expect(prompt).toContain("`wrong-oracle`");
    expect(prompt).toContain("`architecture`");
  });

  it("prefers the project's copy of the phax-review skill on the run's branch", async () => {
    const t = setup();
    t.fs.impl.setFile(
      `${worktreePath}/.claude/skills/phax-review/SKILL.md`,
      "---\nname: phax-review\n---\n\n# Project doctrine\n",
    );
    t.session("session-e", answerOf());

    await t.review();

    const prompt = t.backend.impl.runCalls[0]?.prompt ?? "";
    expect(prompt).toContain("Project doctrine");
    expect(prompt).toContain("(project)");
    expect(prompt).not.toContain("Bundled doctrine");
  });

  it("carries the files the reconciliation flagged and the compliance findings", async () => {
    const t = setup();
    t.fs.impl.setFile(
      `${runPath}/global-file-reconciliation.json`,
      JSON.stringify({
        files: [],
        unplanned: [],
        missing: [],
        attentionPoints: [
          {
            path: "src/flagged.ts",
            plannedInPhases: [],
            touchedInPhases: ["phase-01"],
            optionalInPhases: [],
            expectedActions: [],
            actualActions: [],
            status: "unplanned",
            planned: false,
            unplanned: true,
            missing: false,
            extraTouch: false,
            attention: "review",
          },
        ],
      }),
    );
    t.session("session-f", answerOf());

    await t.review();

    const prompt = t.backend.impl.runCalls[0]?.prompt ?? "";
    expect(prompt).toContain("src/flagged.ts");
    expect(prompt).toContain("No compliance findings are available");
  });

  it("runs under the compliance review's policy for the same worktree", async () => {
    const t = setup();
    t.session("session-g", answerOf());

    await t.review();

    const options = t.backend.impl.runCalls[0]?.options;
    expect(options?.security).toEqual(
      resolveReviewSecurityPolicy({ mode: "secure", worktreePath, config: security.config }),
    );
    expect(options?.security?.filesystem.allowWrite).toEqual([`${worktreePath}/.phax-context`]);
    expect(options?.security?.agentCommands).toEqual(["git"]);
    expect(options?.readOnly).toBeUndefined();
    expect(options?.cwd).toBe(worktreePath);
    expect(options?.outputJsonlPath).toBe(streamPath);
  });

  it("adds one cost ledger entry with role code-review and no phase", async () => {
    const t = setup();
    t.session("session-a", answerOf(), CLAUDE_STREAM);

    await t.review();

    const ledger = JSON.parse(t.fs.impl.getFile(`${runPath}/cost-ledger.json`) ?? "") as {
      entries: ReadonlyArray<{ role: string; phase: string | null }>;
    };
    const last = ledger.entries.at(-1);
    expect(last?.role).toBe("code-review");
    expect(last?.phase).toBeNull();
  });
});

describe("reviewCodeAndRecord", () => {
  const recordsOff: ResolvedRecordsConfig = {
    enabled: false,
    transcript: false,
    destination: { kind: "in-repo" },
    autoPush: false,
  };

  it("makes no pull request call for a run that has an open pull request", async () => {
    const t = setup();
    t.github.impl.existingPrs.set("feature/my-run", "https://github.com/o/r/pull/9");
    t.session("session-h", answerOf(finding()));

    const outcome = await Effect.runPromise(
      reviewCodeAndRecord(
        info,
        config,
        resolutionOn("claude-code"),
        security,
        { kind: "project", records: recordsOff, repoRoot: "/repo", push: null },
        { bundledReviewSkill, nowIso },
      ).pipe(Effect.provide(t.layer)),
    );

    expect(outcome.review.kind).toBe("accepted");
    expect(outcome.record.kind).toBe("records-off");
    expect(t.github.impl.calls).toEqual([]);
  });

  it("reports a failed review as no entry and no push", async () => {
    const t = setup();
    t.session("session-i", undefined);

    const outcome = await Effect.runPromise(
      reviewCodeAndRecord(
        info,
        config,
        resolutionOn("claude-code"),
        security,
        { kind: "project", records: recordsOff, repoRoot: "/repo", push: null },
        { bundledReviewSkill, nowIso },
      ).pipe(Effect.provide(t.layer)),
    );

    expect(outcome.review.kind).toBe("failed");
    expect(outcome.record).toEqual({ kind: "no-entry" });
    expect(outcome.push).toEqual({ kind: "no-record" });
  });

  it("reports an unresolved project without writing an entry", async () => {
    const t = setup();
    t.session("session-j", answerOf());

    const outcome = await Effect.runPromise(
      reviewCodeAndRecord(
        info,
        config,
        resolutionOn("claude-code"),
        security,
        { kind: "unresolved", reason: "no project" },
        { bundledReviewSkill, nowIso },
      ).pipe(Effect.provide(t.layer)),
    );

    expect(outcome.review.kind).toBe("accepted");
    expect(outcome.record).toEqual({ kind: "unresolved", reason: "no project" });
  });
});
