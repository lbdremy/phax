import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  reviewCompliance,
  reviewComplianceAndRecord,
  type ComplianceReviewResult,
} from "../../src/app/reviewCompliance.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName, ClaudeSessionId } from "../../src/domain/branded.js";
import type { ResolvedComplianceReviewConfig } from "../../src/schemas/phaxConfig.js";
import type { ProviderId, RoutingResolution } from "../../src/domain/routing/types.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { answerJsonSchema } from "../../src/schemas/answerSchemas.js";
import type { ComplianceReview } from "../../src/schemas/complianceReview.js";
import { CODE_REVIEW_AGENT_COMMANDS } from "../../src/domain/security/agentCommands.js";
import { renderComplianceReviewMarkdown } from "../../src/domain/review/complianceMarkdown.js";
import { phaseStatus } from "../helpers/phaseStatusFixture.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const worktreePath = "/fake/worktrees/test-run--phase-02";
const jsonPath = `${runPath}/compliance-review.json`;
const mdPath = `${runPath}/compliance-review.md`;
const streamPath = `${runPath}/compliance-review.session.jsonl`;
const retryStreamPath = `${runPath}/compliance-review-retry.session.jsonl`;

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName,
    runId: "test-run-999",
    runState: "review_open",
    branch: "feature/test-run",
    runTitle: "My Run Title",
    finalPhaseBranch: "feature/test-run--phase-02" as BranchName,
    stateRoot,
    runPath,
    finalPhaseId: "phase-02",
    finalPhaseTitle: "Final Phase",
    worktreePath,
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [
      { id: "phase-01", title: "First Phase" },
      { id: "phase-02", title: "Final Phase" },
    ],
    updatedAt: "2026-06-22T12:00:00.000Z",
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

const enabledConfig: ResolvedComplianceReviewConfig = {
  enabled: true,
  model: "claude-sonnet-4-6",
  effort: "medium",
};

const disabledConfig: ResolvedComplianceReviewConfig = { ...enabledConfig, enabled: false };

function resolutionOn(provider: ProviderId): RoutingResolution {
  return {
    requested: { model: "claude-sonnet-4-6", family: "claude-sonnet", effort: "medium" },
    selected: {
      provider,
      family: "claude-sonnet",
      concreteModel: "claude-sonnet-4-6",
      thinking: "medium",
    },
    relationship: "exact",
    reason: "exact match",
  };
}

const fakeSecurity = {
  mode: "secure" as const,
  config: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  } satisfies ResolvedSecurityConfig,
};

const fakePlanMd = "# Plan\n\nThis is the plan.\n";
const fakeReconciliationMd = "# Global File Reconciliation\n\nAll files planned.\n";

const stamp = schemaUrl("compliance-review", CURRENT_STAMPS["compliance-review"]);

const phaseEntry = (phaseId: string) => ({ phaseId, verdict: "conformant", findings: [] });

/** A valid answer for a run of `phaseIds`, with `overrides` applied over it. */
function answerOf(
  phaseIds: readonly string[] = ["phase-01", "phase-02"],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    $schema: stamp,
    verdict: "conformant",
    summary: "All phases conformed.",
    perPhase: phaseIds.map(phaseEntry),
    unplannedChanges: [],
    unmetPromises: [],
    attentionPoints: [],
    pointers: [],
    ...overrides,
  };
}

const textOf = (answer: unknown): string => JSON.stringify(answer);

function setup(options: { readonly seedRunFolder?: boolean } = {}) {
  const fs = makeFakeFileSystem();
  const backend = makeFakeBackend();
  if (options.seedRunFolder !== false) {
    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
  }
  const git = makeFakeGit();
  const github = makeFakeGitHub();
  const layer = Layer.mergeAll(
    backend.layer,
    fs.layer,
    git.layer,
    github.layer,
    NoopSystemTelemetryLayer,
  );
  /** What the use case printed through the output port. */
  const warnings: string[] = [];
  const output = { log() {}, warn: (m: string) => void warnings.push(m), error() {} };
  /** The next session: answers `answer` as its final message. */
  const session = (sessionId: string, answer: string) =>
    backend.impl.addRunResponse({
      sessionId: sessionId as ClaudeSessionId,
      outputPath: streamPath,
      finalText: answer,
    });
  /** The corrective resume: answers `answer` as its final message. */
  const retry = (sessionId: string, answer: string) =>
    backend.impl.addResumeResponse({
      sessionId: sessionId as ClaudeSessionId,
      outputPath: retryStreamPath,
      finalText: answer,
    });
  const review = (
    provider: ProviderId = "claude-code",
    info: RunReviewInfo = makeInfo(),
  ): Promise<ComplianceReviewResult> =>
    Effect.runPromise(
      reviewCompliance(info, enabledConfig, resolutionOn(provider), fakeSecurity, {
        output,
      }).pipe(Effect.provide(layer)),
    );
  const filesUnder = (dir: string): string[] =>
    [...fs.impl.files.keys()].filter((path) => path.startsWith(`${dir}/`));
  return {
    fs,
    backend,
    git,
    github,
    layer,
    warnings,
    output,
    session,
    retry,
    review,
    filesUnder,
  };
}

describe("reviewCompliance", () => {
  it("returns disabled and invokes no agent when config.enabled is false", async () => {
    const t = setup();

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), disabledConfig, resolutionOn("claude-code"), fakeSecurity, {
        output: t.output,
      }).pipe(Effect.provide(t.layer)),
    );

    expect(result).toEqual({ kind: "disabled" });
    expect(t.backend.impl.runCalls).toHaveLength(0);
  });

  it("ac-cr-file, ac-cr-render: writes the answer as given and the Markdown rendered from it", async () => {
    const t = setup();
    t.fs.impl.setFile(`${runPath}/phase-01/phase-handoff.md`, "Phase 01 done.\n");
    const answer = answerOf(["phase-01", "phase-02"], {
      verdict: "conformant-with-deviations",
      unplannedChanges: [{ phaseId: "phase-02", path: "src/extra.ts", note: "not in the plan" }],
      unmetPromises: [{ phaseId: "phase-01", promise: "tests/a.test.ts", note: "not found" }],
      attentionPoints: ["Look at src/extra.ts"],
    });
    t.session("sess-abc", textOf(answer));

    const result = await t.review();

    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") return;
    expect(result.mdArtifactPath).toBe(mdPath);
    expect(result.jsonArtifactPath).toBe(jsonPath);
    expect(result.review.verdict).toBe("conformant-with-deviations");

    // compliance-review.json: the answer as given, `$schema` first at the 0.32.0 stamp.
    const file = JSON.parse(t.fs.impl.getFile(jsonPath) ?? "") as Record<string, unknown>;
    expect(Object.keys(file)[0]).toBe("$schema");
    expect(file["$schema"]).toBe("https://docs.phax.run/schemas/compliance-review/0.32.0.json");
    expect(file).toEqual(answer);
    expect(file["unplannedChanges"]).toHaveLength(1);
    expect(file["unmetPromises"]).toHaveLength(1);

    // compliance-review.md: the renderer's output for that answer, and nothing else.
    expect(t.fs.impl.getFile(mdPath)).toBe(
      renderComplianceReviewMarkdown("test-run-999", result.review),
    );
    const { $schema: _stamp, ...fields } = answer;
    expect(t.fs.impl.getFile(mdPath)).toBe(
      renderComplianceReviewMarkdown("test-run-999", fields as unknown as ComplianceReview),
    );

    expect(t.backend.impl.runCalls).toHaveLength(1);
    expect(t.backend.impl.resumeCalls).toHaveLength(0);
  });

  it("returns failed when global-file-reconciliation.md is missing", async () => {
    const t = setup({ seedRunFolder: false });
    t.fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);

    const result = await t.review();

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failureReason).toMatch(/reconciliation/i);
    expect(t.backend.impl.runCalls).toHaveLength(0);
  });

  it("returns failed when plan.md is missing", async () => {
    const t = setup({ seedRunFolder: false });
    t.fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);

    const result = await t.review();

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.failureReason).toMatch(/plan/i);
    expect(t.backend.impl.runCalls).toHaveLength(0);
  });

  describe("ac-cr-readonly: the session reads and never writes", () => {
    it.each<ProviderId>(["claude-code", "codex-cli", "mistral-vibe"])(
      "on %s it is read-only with exactly the code review's git, and phax writes the files",
      async (provider) => {
        const t = setup();
        t.session("sess-1", textOf(answerOf()));

        const result = await t.review(provider);

        expect(result.kind).toBe("generated");
        const { options } = t.backend.impl.runCalls[0]!;
        expect(options.provider).toBe(provider);
        expect(options.readOnly).toBe(true);
        expect(options.agentCommands).toEqual(CODE_REVIEW_AGENT_COMMANDS);
        expect(options.security?.agentCommands).toEqual([...CODE_REVIEW_AGENT_COMMANDS]);
        expect(options.cwd).toBe(worktreePath);
        expect(options.outputJsonlPath).toBe(streamPath);
        // The answer schema is the compliance-review call's, handed on the first session.
        expect(options.answerSchema).toEqual({
          call: "compliance-review",
          schema: answerJsonSchema("compliance-review"),
        });
        // Nothing is created in the worktree; both files are phax's, in the run folder.
        expect(t.filesUnder(worktreePath)).toEqual([]);
        expect(t.fs.impl.getFile(jsonPath)).toBeDefined();
        expect(t.fs.impl.getFile(mdPath)).toBeDefined();
      },
    );

    it("grants the same options to the corrective resume", async () => {
      const t = setup();
      t.session("sess-1", "not json");
      t.retry("sess-1", textOf(answerOf()));

      await t.review();

      const resume = t.backend.impl.resumeCalls[0]!;
      expect(resume.options.readOnly).toBe(true);
      expect(resume.options.agentCommands).toEqual(CODE_REVIEW_AGENT_COMMANDS);
      expect(resume.options.answerSchema?.call).toBe("compliance-review");
      expect(resume.options.outputJsonlPath).toBe(retryStreamPath);
    });

    it("gives the prompt the run's branch and, with a base noted, its diff command", async () => {
      const t = setup();
      t.session("sess-1", textOf(answerOf()));
      const base = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
      const statuses = [2, 1].map((phaseIndex) =>
        phaseStatus({
          phaseId: `phase-0${phaseIndex}`,
          phaseIndex,
          state: "passed",
          model: "claude-sonnet-5-5",
          effort: "medium",
          branchName: `feature/test-run--phase-0${phaseIndex}`,
          base: phaseIndex === 1 ? base : "f".repeat(40),
          createdAt: "2026-06-22T12:00:00.000Z",
          updatedAt: "2026-06-22T12:00:00.000Z",
        }),
      );

      await t.review("claude-code", makeInfo({ phaseStatuses: statuses }));

      const prompt = t.backend.impl.runCalls[0]!.prompt;
      expect(prompt).toContain("`feature/test-run`");
      expect(prompt).toContain(`git diff ${base}..HEAD`);
      expect(prompt).not.toContain("/.phax-context/");
      expect(prompt).toContain(JSON.stringify(answerJsonSchema("compliance-review"), null, 2));
    });
  });

  describe("ac-vibe: the schema is stated, and the answer is checked", () => {
    it("resumes a Vibe review whose first answer omits unmetPromises and writes the retry's", async () => {
      const t = setup();
      const { unmetPromises: _omitted, ...incomplete } = answerOf();
      t.session("sess-v", textOf(incomplete));
      t.retry("sess-v", textOf(answerOf(["phase-01", "phase-02"], { summary: "Second try." })));

      const result = await t.review("mistral-vibe");

      expect(result.kind).toBe("generated");
      const prompt = t.backend.impl.runCalls[0]!.prompt;
      expect(prompt).toContain(JSON.stringify(answerJsonSchema("compliance-review"), null, 2));
      expect(t.warnings).toHaveLength(1);
      expect(t.warnings[0]).toMatch(/^compliance-review answer refused — .*unmetPromises/);
      expect(t.warnings[0]).toContain(
        "resuming the session once to ask for the whole answer again",
      );
      expect(t.backend.impl.resumeCalls).toHaveLength(1);
      const resume = t.backend.impl.resumeCalls[0]!;
      expect(resume.sessionId).toBe("sess-v");
      expect(resume.options.provider).toBe("mistral-vibe");
      expect(resume.prompt).toContain("Your last answer was refused");
      expect(JSON.parse(t.fs.impl.getFile(jsonPath) ?? "")["summary"]).toBe("Second try.");
    });

    it("ac-vibe-empty: refuses an empty first answer as not JSON and resumes once", async () => {
      const t = setup();
      t.session("sess-v", "");
      t.retry("sess-v", textOf(answerOf()));

      const result = await t.review("mistral-vibe");

      expect(result.kind).toBe("generated");
      expect(t.warnings[0]).toMatch(
        /^compliance-review answer refused — the session's final message is not JSON/,
      );
      expect(t.backend.impl.resumeCalls).toHaveLength(1);
    });
  });

  describe("ac-cr-phases: perPhase covers the run", () => {
    it("refuses an answer naming phase-04 and missing phase-03, then resumes once", async () => {
      const t = setup();
      const planPhases = ["phase-01", "phase-02", "phase-03"].map((id) => ({
        id,
        title: `Title of ${id}`,
      }));
      t.session("sess-1", textOf(answerOf(["phase-01", "phase-02", "phase-04"])));
      t.retry("sess-1", textOf(answerOf(["phase-03", "phase-01", "phase-02"])));

      const result = await t.review("claude-code", makeInfo({ planPhases }));

      expect(result.kind).toBe("generated");
      expect(t.warnings).toHaveLength(1);
      expect(t.warnings[0]).toContain('perPhase: phase "phase-04" is not a phase of this run');
      expect(t.warnings[0]).toContain('perPhase: phase "phase-03" is missing');
      expect(t.backend.impl.resumeCalls).toHaveLength(1);
      expect(t.backend.impl.resumeCalls[0]!.prompt).toContain('phase "phase-04"');
      // The order of perPhase is free: the retry's order is the one written.
      const written = JSON.parse(t.fs.impl.getFile(jsonPath) ?? "") as {
        perPhase: Array<{ phaseId: string }>;
      };
      expect(written.perPhase.map((p) => p.phaseId)).toEqual(["phase-03", "phase-01", "phase-02"]);
    });

    it("states the run's phase ids in the prompt", async () => {
      const t = setup();
      t.session("sess-1", textOf(answerOf()));

      await t.review();

      expect(t.backend.impl.runCalls[0]!.prompt).toContain("`phase-01`, `phase-02`");
    });
  });

  describe("ac-cr-refused: a twice-refused answer writes nothing", () => {
    const refusals: ReadonlyArray<readonly [string, string, RegExp]> = [
      ["text that is not JSON", "not json at all", /the session's final message is not JSON/],
      ["no answer at all", "", /the session's final message is not JSON/],
      [
        "the old version-1 shape",
        textOf({
          version: 1,
          verdict: "conformant",
          summary: "x",
          perPhase: [phaseEntry("phase-01"), phaseEntry("phase-02")],
          attentionPoints: [],
          pointers: [],
        }),
        /\$schema/,
      ],
      [
        "no unplannedChanges",
        textOf({ ...answerOf(), unplannedChanges: undefined }),
        /unplannedChanges/,
      ],
      [
        "a verdict outside the enum",
        textOf(answerOf(["phase-01", "phase-02"], { verdict: "unknown" })),
        /verdict/,
      ],
      ["an excess key", textOf(answerOf(["phase-01", "phase-02"], { bogus: 1 })), /bogus/],
      [
        "a perPhase naming a phase twice",
        textOf(answerOf(["phase-01", "phase-01", "phase-02"])),
        /named more than once/,
      ],
    ];

    it.each(refusals)(
      "%s, refused twice, fails naming both refusals and leaves an earlier review's files as they were",
      async (_name, answer, reason) => {
        const t = setup();
        t.fs.impl.setFile(jsonPath, "previous json");
        t.fs.impl.setFile(mdPath, "previous md");
        t.session("sess-1", answer);
        t.retry("sess-1", answer);

        const result = await t.review();

        expect(result.kind).toBe("failed");
        if (result.kind !== "failed") return;
        expect(result.failureReason).toMatch(
          /^compliance-review answer rejected twice — first answer: /,
        );
        expect(result.failureReason).toMatch(reason);
        expect(result.failureReason).toContain("; retry: ");
        expect(t.backend.impl.resumeCalls).toHaveLength(1);
        expect(t.fs.impl.getFile(jsonPath)).toBe("previous json");
        expect(t.fs.impl.getFile(mdPath)).toBe("previous md");
      },
    );

    it("writes no file at all when there was no earlier review", async () => {
      const t = setup();
      t.session("sess-1", "not json at all");
      t.retry("sess-1", "still not json");

      const result = await t.review();

      expect(result.kind).toBe("failed");
      expect(t.fs.impl.getFile(jsonPath)).toBeUndefined();
      expect(t.fs.impl.getFile(mdPath)).toBeUndefined();
      expect(t.filesUnder(worktreePath)).toEqual([]);
    });

    it("never carries an unknown verdict: a refused answer is a failure", async () => {
      const t = setup();
      t.session("sess-1", "not json at all");
      t.retry("sess-1", "still not json");

      const result = await t.review();

      expect(result).not.toHaveProperty("verdict");
      expect(result).not.toHaveProperty("structuredVerdictMissing");
    });
  });

  describe("a failed session is never a refusal", () => {
    it("returns failed with the session failure when the first session fails", async () => {
      const t = setup();
      t.backend.impl.failRunWithRateLimit(0, { kind: "rate_limit" });

      const result = await t.review();

      expect(result.kind).toBe("failed");
      if (result.kind !== "failed") return;
      expect(result.failureReason).toMatch(/agent invocation failed/i);
      expect(t.backend.impl.resumeCalls).toHaveLength(0);
      expect(t.fs.impl.getFile(jsonPath)).toBeUndefined();
    });

    it("reports a failed resume as a session failure, not as a refusal, and keeps the earlier review", async () => {
      const t = setup();
      t.fs.impl.setFile(jsonPath, "previous json");
      t.fs.impl.setFile(mdPath, "previous md");
      t.session("sess-1", "not json at all");
      // No queued resume response: the fake backend fails the call.

      const result = await t.review();

      expect(result.kind).toBe("failed");
      if (result.kind !== "failed") return;
      expect(result.failureReason).toMatch(/^Agent invocation failed: /);
      expect(result.failureReason).not.toMatch(/rejected twice/);
      expect(t.fs.impl.getFile(jsonPath)).toBe("previous json");
      expect(t.fs.impl.getFile(mdPath)).toBe("previous md");
    });
  });

  describe("the pair is replaced together or left as it was", () => {
    it("puts the earlier json back when the Markdown cannot be written", async () => {
      const t = setup();
      t.fs.impl.setFile(jsonPath, "previous json");
      t.fs.impl.setFile(mdPath, "previous md");
      t.fs.impl.failWriteAtomic(mdPath, "disk full");
      t.session("sess-1", textOf(answerOf()));

      const result = await t.review();

      expect(result).toEqual({
        kind: "failed",
        failureReason: expect.stringContaining("the review could not be kept: "),
      });
      expect(result.kind === "failed" && result.failureReason).toContain("disk full");
      expect(t.fs.impl.getFile(jsonPath)).toBe("previous json");
      expect(t.fs.impl.getFile(mdPath)).toBe("previous md");
    });

    it("removes the json when there was none and the Markdown cannot be written", async () => {
      const t = setup();
      t.fs.impl.failWriteAtomic(mdPath, "disk full");
      t.session("sess-1", textOf(answerOf()));

      const result = await t.review();

      expect(result.kind).toBe("failed");
      expect(t.fs.impl.getFile(jsonPath)).toBeUndefined();
      expect(t.fs.impl.getFile(mdPath)).toBeUndefined();
    });

    it("replaces both files of an earlier review with only its own", async () => {
      const t = setup();
      t.session("sess-1", textOf(answerOf(["phase-01", "phase-02"], { summary: "First." })));
      await t.review();
      t.session("sess-2", textOf(answerOf(["phase-01", "phase-02"], { summary: "Second." })));
      await t.review();

      expect(JSON.parse(t.fs.impl.getFile(jsonPath) ?? "")["summary"]).toBe("Second.");
      expect(t.fs.impl.getFile(mdPath)).toContain("Second.");
      expect(t.fs.impl.getFile(mdPath)).not.toContain("First.");
    });
  });

  it("inlines phase handoff content into the prompt passed to the backend", async () => {
    const t = setup();
    t.fs.impl.setFile(
      `${runPath}/phase-01/phase-handoff.md`,
      "## What was delivered\nPhase 01 artifact.\n",
    );
    t.session("sess-1", textOf(answerOf()));

    await t.review();

    const prompt = t.backend.impl.runCalls[0]!.prompt;
    expect(prompt).toContain("Phase 01 artifact.");
    expect(prompt).toContain("### Phase phase-01 handoff");
    expect(prompt).toContain("phase-handoff.md unavailable for phase-02");
  });
});

describe("reviewComplianceAndRecord", () => {
  const target = { kind: "unresolved", reason: "no records for this test" } as const;
  const record = (t: ReturnType<typeof setup>) =>
    Effect.runPromise(
      reviewComplianceAndRecord(
        makeInfo(),
        enabledConfig,
        resolutionOn("claude-code"),
        fakeSecurity,
        target,
        { output: t.output },
      ).pipe(Effect.provide(t.layer)),
    );

  it("records an entry's outcome only for an accepted review", async () => {
    const t = setup();
    t.session("sess-1", textOf(answerOf()));

    const outcome = await record(t);

    expect(outcome.review.kind).toBe("generated");
    expect(outcome.record).toEqual({ kind: "unresolved", reason: "no records for this test" });
  });

  it("records nothing for a review that failed", async () => {
    const t = setup();
    t.session("sess-1", "not json");
    t.retry("sess-1", "not json");

    const outcome = await record(t);

    expect(outcome.review.kind).toBe("failed");
    expect(outcome.record).toEqual({ kind: "no-entry" });
  });
});
