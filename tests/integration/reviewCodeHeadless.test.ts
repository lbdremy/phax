// The headless code review (spec headless-code-review §5.20–§5.22): one read-only
// session answers with its final message; an accepted answer becomes
// code-review.json and the run's review session, any other outcome writes
// neither, and a session that changed the worktree has it put back. Driven through the use case with the fake file
// system, backend, git and GitHub.
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { reviewCodeAndRecord, reviewCodeHeadless } from "../../src/app/reviewCode.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import { CODE_REVIEW_AGENT_COMMANDS } from "../../src/domain/security/agentCommands.js";
import { resolveReviewSecurityPolicy } from "../../src/domain/security/resolveReviewPolicy.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

const stateRoot = "/fake-state";
const runPath = `${stateRoot}/runs/my-run`;
const worktreePath = "/fake/worktrees/my-run--phase-01";
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

const answerOf = (...findings: unknown[]) =>
  JSON.stringify({ $schema: schemaUrl("code-review", CURRENT_STAMPS["code-review"]), findings });

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
  /** The next session: answers `answer` as its final message (none when undefined). */
  const session = (sessionId: string, answer: string | undefined, stream?: string) => {
    backend.impl.setOnRunAgent((_prompt, options) => {
      if (stream !== undefined) fs.impl.setFile(options.outputJsonlPath ?? streamPath, stream);
    });
    backend.impl.addRunResponse({
      sessionId: sessionId as ClaudeSessionId,
      outputPath: streamPath,
      finalText: answer ?? "",
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
    ["a session that gave no answer", undefined, /^the session gave no answer$/],
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

  it("reads an answer wrapped in a json fence", async () => {
    const t = setup();
    t.session("session-c", "```json\n" + answerOf(finding()) + "\n```");

    const result = await t.review();

    expect(result.kind).toBe("accepted");
  });

  it("puts back what a session changed in the worktree and refuses its answer", async () => {
    const t = setup();
    t.fs.impl.setFile(reviewPath, "previous review");
    t.git.impl.enqueueSnapshots(worktreePath, "a".repeat(40), "b".repeat(40));
    t.git.impl.setTreeChanges("a".repeat(40), "b".repeat(40), [
      { status: "M", path: "src/b.ts" },
      { status: "A", path: "src/a.ts" },
    ]);
    t.session("session-w", answerOf(finding()));

    const result = await t.review();

    expect(result).toEqual({
      kind: "failed",
      reason: "the session changed the worktree (put back): src/a.ts, src/b.ts",
    });
    expect(t.git.impl.calls).toContainEqual({
      method: "restorePaths",
      path: worktreePath,
      tree: "a".repeat(40),
      paths: ["src/a.ts", "src/b.ts"],
    });
    expect(t.fs.impl.getFile(reviewPath)).toBe("previous review");
    expect(t.fs.impl.getFile(sessionPath)).toBeUndefined();
  });

  it("leaves both files as they were when the session record cannot be written", async () => {
    const t = setup();
    t.fs.impl.setFile(reviewPath, "previous review");
    t.fs.impl.setFile(sessionPath, "previous session");
    t.fs.impl.failWriteAtomic(sessionPath, "EACCES: permission denied");
    t.session("session-k", answerOf(finding()));

    const result = await t.review();

    expect(result).toEqual({
      kind: "failed",
      reason: "the review could not be kept: EACCES: permission denied",
    });
    expect(t.fs.impl.getFile(reviewPath)).toBe("previous review");
    expect(t.fs.impl.getFile(sessionPath)).toBe("previous session");
  });

  it("removes a first review file when its session record cannot be written", async () => {
    const t = setup();
    t.fs.impl.failWriteAtomic(sessionPath, "ENOSPC: no space left on device");
    t.session("session-l", answerOf(finding()));

    const result = await t.review();

    expect(result.kind).toBe("failed");
    expect(t.fs.impl.getFile(reviewPath)).toBeUndefined();
    expect(t.fs.impl.getFile(sessionPath)).toBeUndefined();
  });

  it("carries the bundled doctrine, the closed ids and the final-message answer", async () => {
    const t = setup();
    t.session("session-d", answerOf());

    await t.review();

    const prompt = t.backend.impl.runCalls[0]?.prompt ?? "";
    expect(prompt).toContain("Bundled doctrine");
    expect(prompt).toContain("(bundled)");
    expect(prompt).toContain("Your final message is your answer");
    expect(prompt).toContain("`git log`");
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

  it("runs read-only, with read-only git, under the review policy for the same worktree", async () => {
    const t = setup();
    t.session("session-g", answerOf());

    await t.review();

    const options = t.backend.impl.runCalls[0]?.options;
    expect(options?.security).toEqual({
      ...resolveReviewSecurityPolicy({ mode: "secure", worktreePath, config: security.config }),
      agentCommands: [...CODE_REVIEW_AGENT_COMMANDS],
    });
    expect(options?.readOnly).toBe(true);
    expect(options?.agentCommands).toEqual(CODE_REVIEW_AGENT_COMMANDS);
    expect(options?.agentCommands).not.toContain("git");
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
