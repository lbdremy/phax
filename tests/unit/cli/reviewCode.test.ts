import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { runReviewCode } from "../../../src/cli/commands/reviewCode.js";
import type { RunReviewInfo } from "../../../src/domain/runReviewInfo.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import type { BranchName } from "../../../src/domain/branded.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";

const SHORT_NAME = "my-run";

vi.mock("../../../src/app/loadConfig.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/loadConfig.js")>()),
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/resolveRunRef.js", () => ({
  resolveRunRef: vi.fn(),
}));

vi.mock("../../../src/app/reviewCode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/reviewCode.js")>()),
  reviewCodeAndRecord: vi.fn(),
  prepareCodeReviewSession: vi.fn(),
}));

vi.mock("../../../src/app/loadRouting.js", () => ({
  loadModelRouting: vi.fn(),
  loadProviderConfig: vi.fn(),
}));

vi.mock("../../../src/app/projectContext.js", () => ({
  effectiveStateRoot: vi.fn().mockReturnValue("/fake-state"),
}));

vi.mock("../../../src/domain/routing/resolve.js", () => ({
  resolveModel: vi
    .fn()
    .mockReturnValue({ kind: "resolved", provider: "claude", model: "claude-opus-5-5" }),
}));

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, errors };
}

function makeConfig(): ResolvedConfig {
  return {
    raw: {} as ResolvedConfig["raw"],
    namespace: "louloupapers",
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: {
      profile: "secure",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
    codeReview: { enabled: false, model: "claude-opus-5-5", effort: "high" },
    authoring: {
      spec: { model: "claude-opus-5-5", effort: "high" },
      plan: { model: "claude-opus-5-5", effort: "high" },
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  };
}

function makeInfo(runState: RunReviewInfo["runState"] = "review_open"): RunReviewInfo {
  return {
    namespace: "louloupapers",
    shortName: SHORT_NAME,
    runId: "run-999",
    runState,
    branch: `feature/${SHORT_NAME}`,
    runTitle: "My Run",
    finalPhaseBranch: `feature/${SHORT_NAME}--phase-01` as BranchName,
    stateRoot: "/fake-state",
    runPath: `/fake-state/runs/${SHORT_NAME}`,
    finalPhaseId: "phase-01",
    finalPhaseTitle: "Phase One",
    worktreePath: "/wt",
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [],
    updatedAt: "2026-06-12T00:00:00Z",
    stoppedReason: undefined,
    lastError: undefined,
  };
}

const finding = (severity: "bug" | "concern") => ({
  severity,
  file: "src/a.ts",
  line: 3,
  message: "m",
  lens: "caller",
  escape: "tests-never-ran-it",
  criterion: null,
  suggestion: "s",
});

const accepted = (findings: readonly unknown[], extra: Record<string, unknown> = {}) =>
  Effect.succeed({
    review: {
      kind: "accepted",
      review: { $schema: "x", findings },
      reviewPath: "/run/code-review.json",
      session: {},
    },
    record: { kind: "no-entry" },
    push: { kind: "no-record" },
    ...extra,
  } as never);

async function setup(info: RunReviewInfo, crossProject = false, namespace = "louloupapers") {
  const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
  loadConfig.mockReturnValue(Either.right(makeConfig()));
  const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
  resolveRunRef.mockReturnValue(
    Either.right({ namespace, shortName: SHORT_NAME, info, crossProject }),
  );
  const { loadModelRouting, loadProviderConfig } = vi.mocked(
    await import("../../../src/app/loadRouting.js"),
  );
  loadModelRouting.mockReturnValue(Effect.succeed(DEFAULT_MODEL_ROUTING));
  loadProviderConfig.mockReturnValue(Effect.succeed(DEFAULT_PROVIDER_CONFIG));
  return vi.mocked(await import("../../../src/app/reviewCode.js"));
}

describe("runReviewCode --headless", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints the count line and the resume command, and exits 0, with review.code.enabled absent", async () => {
    const mocks = await setup(makeInfo());
    mocks.reviewCodeAndRecord.mockReturnValue(accepted([finding("bug"), finding("concern")]));

    const { out, lines, errors } = makeOutput();
    const code = await runReviewCode(SHORT_NAME, { headless: true }, out);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      "Code review: 2 findings (1 bug, 1 concern)",
      "Findings: /run/code-review.json",
      `Fix them in the session: phax review-code ${SHORT_NAME}`,
    ]);
  });

  it("exits 1 naming the state and starts no session when the run is not review_open", async () => {
    const mocks = await setup(makeInfo("running"));

    const { out, errors } = makeOutput();
    const code = await runReviewCode(SHORT_NAME, { headless: true }, out);

    expect(code).toBe(1);
    expect(errors.join("")).toContain("running");
    expect(mocks.reviewCodeAndRecord).not.toHaveBeenCalled();
  });

  it("exits 1 naming the refusal and the retry command when the review fails", async () => {
    const mocks = await setup(makeInfo());
    mocks.reviewCodeAndRecord.mockReturnValue(
      Effect.succeed({
        review: { kind: "failed", reason: "answer refused: findings[0].lens: not a lens" },
        record: { kind: "no-entry" },
        push: { kind: "no-record" },
      } as never),
    );

    const { out, errors } = makeOutput();
    const code = await runReviewCode(SHORT_NAME, { headless: true }, out);

    expect(code).toBe(1);
    expect(errors).toEqual([
      `Code review failed: answer refused: findings[0].lens: not a lens. To retry, run: phax review-code ${SHORT_NAME} --headless`,
    ]);
  });

  it("names the qualified run in the retry command for a run of another project", async () => {
    const mocks = await setup({ ...makeInfo(), namespace: "other-ns" }, true, "other-ns");
    mocks.reviewCodeAndRecord.mockReturnValue(
      Effect.succeed({
        review: { kind: "failed", reason: "no answer" },
        record: { kind: "no-entry" },
        push: { kind: "no-record" },
      } as never),
    );

    const { out, errors } = makeOutput();
    await runReviewCode(SHORT_NAME, { headless: true }, out);

    expect(errors).toEqual([
      `Code review failed: no answer. To retry, run: phax review-code other-ns.${SHORT_NAME} --headless`,
    ]);
  });

  it("exits 0 and prints the pending-entry warning when the records commit failed", async () => {
    const mocks = await setup(makeInfo());
    mocks.reviewCodeAndRecord.mockReturnValue(
      accepted([finding("bug")], {
        record: { kind: "write-failed", message: "disk full" },
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runReviewCode(SHORT_NAME, { headless: true }, out);

    expect(code).toBe(0);
    expect(lines[0]).toBe("Code review: 1 finding (1 bug)");
    const warning = lines.find((l) => l.startsWith("WARN: "));
    expect(warning).toContain("code-review");
    expect(warning).toContain("disk full");
    expect(warning).toContain(`phax review-code ${SHORT_NAME} --headless`);
  });
});
