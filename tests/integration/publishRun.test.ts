import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { publishRun } from "../../src/app/publishRun.js";
import { generateReviewHandoff } from "../../src/app/reviewHandoff.js";
import { encodePhaseFileReconciliation } from "../../src/schemas/reconciliation.js";
import { reconciliationResult } from "../helpers/reconciliationFixture.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { ResolvedPublishConfig } from "../../src/schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { currentSchemaUrl, withSchemaUrl } from "../../src/schemas/persisted.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const repoRoot = "/fake-repo";
const finalBranch = "feature/test-run--phase-01" as BranchName;
const now = "2026-06-12T12:00:00.000Z";

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName,
    runId: "test-run-999",
    runState: "review_open",
    branch: "feature/test-run",
    runTitle: "My Run Title",
    finalPhaseBranch: finalBranch,
    stateRoot,
    runPath,
    finalPhaseId: "phase-01",
    finalPhaseTitle: "Final Phase",
    worktreePath: "/fake/wt",
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [{ id: "phase-01", title: "Final Phase" }],
    updatedAt: now,
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

function defaultConfig(overrides: Partial<ResolvedPublishConfig> = {}): ResolvedPublishConfig {
  return {
    auto: true,
    remote: "origin",
    provider: "github",
    pushBranch: true,
    createPullRequest: true,
    ...overrides,
  };
}

function setupLayers() {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const github = makeFakeGitHub();
  const layers = Layer.mergeAll(fs.layer, git.layer, github.layer, NoopSystemTelemetryLayer);
  return { fs, git, github, layers };
}

function runStatusJson(planRepoRelPath?: string): string {
  return JSON.stringify(
    withSchemaUrl("run-status", {
      namespace: "test-project",
      shortName,
      runId: "test-run-999",
      state: "review_open",
      createdAt: now,
      updatedAt: now,
      phasesCount: 1,
      ...(planRepoRelPath !== undefined ? { planRepoRelPath } : {}),
    }),
  );
}

function seedSuccessPreconditions(args: {
  fs: ReturnType<typeof makeFakeFileSystem>;
  git: ReturnType<typeof makeFakeGit>;
  handoffMd?: string;
  planRepoRelPath?: string;
}) {
  args.fs.impl.setFile(
    `${runPath}/review-handoff.md`,
    args.handoffMd ?? "# Review Handoff\n\nSentinel content.",
  );
  args.fs.impl.setFile(`${runPath}/run-status.json`, runStatusJson(args.planRepoRelPath));
  args.git.impl.addExistingBranch(finalBranch);
  args.git.impl.addExistingRemote("origin");
}

const constNow = () => now;

const complianceReviewJson = JSON.stringify({
  $schema: currentSchemaUrl("compliance-review"),
  verdict: "conformant-with-deviations",
  summary: "Mostly as planned.",
  perPhase: [
    {
      phaseId: "phase-01",
      verdict: "conformant-with-deviations",
      findings: [
        {
          dimension: "files",
          severity: "deviation",
          message: "The greeting module was added without a planned entry",
        },
      ],
    },
  ],
  attentionPoints: ["Check the greeting fallback in phase-01"],
  pointers: ["src/greet.ts line 12"],
});

function makePhaseStatus(phaseId: string, phaseIndex: number): PhaseStatus {
  return {
    phaseId,
    phaseIndex,
    state: "committed",
    model: "claude-opus-5-5",
    effort: "medium",
    branchName: `feature/test-run--${phaseId}` as BranchName,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
  };
}

describe("publishRun", () => {
  it("attempts publication even when publish.auto is false (flag no longer gates manual publish)", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    github.impl.setCreatedPrUrl("https://github.com/owner/repo/pull/99");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig({ auto: false }), {
        repoRoot,
        now: constNow,
      }).pipe(Effect.provide(layers)),
    );

    expect(result.kind).toBe("published");
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/99");
    expect(fs.impl.getFile(`${runPath}/publication.json`)).toBeDefined();
  });

  it("happy path: pushes, creates a PR, writes publication.json and final-report.md PR section", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    github.impl.setCreatedPrUrl("https://github.com/owner/repo/pull/42");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("published");
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");
    expect(result.record?.pushStatus).toBe("pushed");
    expect(result.record?.prStatus).toBe("created");

    const pubJson = fs.impl.getFile(`${runPath}/publication.json`);
    expect(pubJson).toBeDefined();
    const pub = JSON.parse(pubJson!) as { pullRequestUrl: string; version: number };
    expect(pub.version).toBe(1);
    expect(pub.pullRequestUrl).toBe("https://github.com/owner/repo/pull/42");

    const report = fs.impl.getFile(`${runPath}/final-report.md`);
    expect(report).toBeDefined();
    expect(report).toContain("## Pull request");
    expect(report).toContain("https://github.com/owner/repo/pull/42");

    const pushed = git.impl.calls.find((c) => c.method === "pushBranch");
    expect(pushed).toBeDefined();

    const created = github.impl.calls.find((c) => c.method === "createPullRequest");
    expect(created).toBeDefined();
  });

  it("uses configured baseBranch when set, otherwise queries default", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig({ baseBranch: "develop" }), {
        repoRoot,
        now: constNow,
      }).pipe(Effect.provide(layers)),
    );

    expect(github.impl.calls.some((c) => c.method === "defaultBaseBranch")).toBe(false);
    const created = github.impl.calls.find(
      (c): c is Extract<(typeof github.impl.calls)[number], { method: "createPullRequest" }> =>
        c.method === "createPullRequest",
    );
    expect(created?.base).toBe("develop");
  });

  it("uses selected PR title precedence: configured > runTitle > phaseTitle > shortName", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig({ title: "Custom Title" }), {
        repoRoot,
        now: constNow,
      }).pipe(Effect.provide(layers)),
    );

    const created = github.impl.calls.find(
      (c): c is Extract<(typeof github.impl.calls)[number], { method: "createPullRequest" }> =>
        c.method === "createPullRequest",
    );
    expect(created?.title).toBe("Custom Title");
  });

  it("reuses an existing PR (idempotency): prStatus exists, no duplicate createPullRequest", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    github.impl.seedExistingPr(finalBranch as string, "https://github.com/owner/repo/pull/7");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("published");
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/7");
    expect(result.record?.prStatus).toBe("exists");

    expect(github.impl.calls.some((c) => c.method === "createPullRequest")).toBe(false);

    const pubJson = JSON.parse(fs.impl.getFile(`${runPath}/publication.json`)!) as {
      prStatus: string;
      pullRequestUrl: string;
    };
    expect(pubJson.prStatus).toBe("exists");
    expect(pubJson.pullRequestUrl).toBe("https://github.com/owner/repo/pull/7");
  });

  it("re-running on an already-pushed branch is success", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    git.impl.pushedBranches.add(finalBranch);

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("published");
    expect(result.record?.pushStatus).toBe("pushed");
    expect(github.impl.calls.some((c) => c.method === "createPullRequest")).toBe(true);
  });

  it("gh unavailable: returns failed result, writes publication.json with failure reason, effect does not fail", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    github.impl.setAvailable(false);

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.failureReason).toMatch(/gh/i);

    const pubJson = JSON.parse(fs.impl.getFile(`${runPath}/publication.json`)!) as {
      pushStatus: string;
      prStatus: string;
      failureReason: string;
    };
    expect(pubJson.pushStatus).toBe("not_attempted");
    expect(pubJson.prStatus).toBe("not_attempted");
    expect(pubJson.failureReason).toBeDefined();

    const report = fs.impl.getFile(`${runPath}/final-report.md`);
    expect(report).toContain("phax publish-pr");
  });

  it("gh not authenticated: returns failed result", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    github.impl.setAuthenticated(false);

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.failureReason).toMatch(/authenticated/i);
  });

  it("missing review-handoff.md: returns failed result, does not push", async () => {
    const { fs, git, layers } = setupLayers();
    // Note: skip handoff seeding
    git.impl.addExistingBranch(finalBranch);
    git.impl.addExistingRemote("origin");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.failureReason).toMatch(/review handoff/i);
    expect(git.impl.calls.some((c) => c.method === "pushBranch")).toBe(false);
    expect(fs.impl.getFile(`${runPath}/publication.json`)).toBeDefined();
  });

  it("pushBranch failure: returns failed with pushStatus=failed and prStatus=not_attempted", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    git.impl.failNextPushBranch("remote rejected");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.record?.pushStatus).toBe("failed");
    expect(result.record?.prStatus).toBe("not_attempted");
    expect(github.impl.calls.some((c) => c.method === "createPullRequest")).toBe(false);
  });

  it("createPullRequest=false skips PR creation but still pushes and records success", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig({ createPullRequest: false }), {
        repoRoot,
        now: constNow,
      }).pipe(Effect.provide(layers)),
    );

    expect(result.kind).toBe("published");
    expect(result.record?.pushStatus).toBe("pushed");
    expect(result.record?.prStatus).toBe("not_attempted");
    expect(github.impl.calls.some((c) => c.method === "createPullRequest")).toBe(false);
  });

  it("carries the compliance verdict and attention points from compliance-review.json, never a finding", async () => {
    const { fs, git, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    fs.impl.setFile(`${runPath}/compliance-review.json`, complianceReviewJson);

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
    expect(body).toContain("**Compliance** conformant-with-deviations");
    expect(body).toContain("### Compliance attention points");
    expect(body).toContain("- Check the greeting fallback in phase-01");
    expect(body).not.toContain("The greeting module was added without a planned entry");
    expect(body).not.toContain("Mostly as planned.");
    expect(body).not.toContain("## Plan compliance review");
    expect(body).not.toContain("## Phase details");
  });

  it("says not reviewed when compliance-review.json is absent", async () => {
    const { fs, git, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
    expect(body).toContain("**Compliance** not reviewed");
    expect(body).not.toContain("### Compliance attention points");
  });

  it("states the source-spec outcome in the summary when source-spec-outcome.md exists", async () => {
    const { fs, git, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    const outcome =
      "`docs/specs/2609101270-demo.md` — kept: this plan does not complete it (completes-spec: false)";
    fs.impl.setFile(`${runPath}/source-spec-outcome.md`, `${outcome}\n`);

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
    expect(body).toContain(`**Spec** ${outcome}`);
    expect(body).not.toContain("## Source spec");
  });

  it("has no spec line when source-spec-outcome.md is absent", async () => {
    const { fs, git, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
    expect(body).not.toContain("**Spec**");
  });

  it("gives gh pr create the persisted pr-body.md, written before the call", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    let bodyAtCreate: string | undefined;
    const create = github.impl.createPullRequest.bind(github.impl);
    github.impl.createPullRequest = (input) => {
      bodyAtCreate = fs.impl.getFile(input.bodyFile);
      return create(input);
    };

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    const created = github.impl.calls.find(
      (c): c is Extract<(typeof github.impl.calls)[number], { method: "createPullRequest" }> =>
        c.method === "createPullRequest",
    );
    expect(created?.bodyFile).toBe(`${runPath}/pr-body.md`);
    expect(bodyAtCreate).toBeDefined();
    expect(bodyAtCreate).toBe(fs.impl.getFile(`${runPath}/pr-body.md`));
    expect(bodyAtCreate).not.toMatch(/^# /m);
  });

  it("points to review-handoff.md under ~ when the home directory holds the run folder", async () => {
    const { fs, git, layers } = setupLayers();
    const homeDir = "/home/ada";
    const homeRunPath = `${homeDir}/.phax/runs/test-project.test-run`;
    fs.impl.setFile(`${homeRunPath}/review-handoff.md`, "# Review Handoff\n");
    fs.impl.setFile(`${homeRunPath}/run-status.json`, runStatusJson());
    git.impl.addExistingBranch(finalBranch);
    git.impl.addExistingRemote("origin");

    await Effect.runPromise(
      publishRun(makeInfo({ runPath: homeRunPath }), defaultConfig(), {
        repoRoot,
        now: constNow,
        homeDir,
      }).pipe(Effect.provide(layers)),
    );

    const body = fs.impl.getFile(`${homeRunPath}/pr-body.md`)!;
    expect(body).toContain("`~/.phax/runs/test-project.test-run/review-handoff.md`");
    expect(body).toContain("phax review-handoff test-run");
    expect(body).not.toContain(homeDir);
    expect(body).not.toMatch(/branch/i);
  });

  it("names phax records explain only when records are enabled", async () => {
    const records: ResolvedRecordsConfig = {
      enabled: true,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    };
    for (const [opts, expected] of [
      [{ records }, true],
      [{ records: { ...records, enabled: false } }, false],
      [{}, false],
    ] as const) {
      const { fs, git, layers } = setupLayers();
      seedSuccessPreconditions({ fs, git });

      await Effect.runPromise(
        publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow, ...opts }).pipe(
          Effect.provide(layers),
        ),
      );

      const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
      expect(body.includes("phax records explain")).toBe(expected);
    }
  });

  it("names the plan path from run-status.json, or a loose plan without one", async () => {
    for (const [planRepoRelPath, expected] of [
      [
        "docs/plans/2610101200-greet-cli-plan.md",
        "**Plan** `docs/plans/2610101200-greet-cli-plan.md`",
      ],
      [undefined, "**Plan** loose plan"],
    ] as const) {
      const { fs, git, layers } = setupLayers();
      seedSuccessPreconditions({
        fs,
        git,
        ...(planRepoRelPath !== undefined ? { planRepoRelPath } : {}),
      });

      await Effect.runPromise(
        publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
          Effect.provide(layers),
        ),
      );

      expect(fs.impl.getFile(`${runPath}/pr-body.md`)).toContain(expected);
    }
  });

  it("fails publication without creating a PR when run-status.json is unreadable", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    fs.impl.setFile(`${runPath}/run-status.json`, "{ not json");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.record?.prStatus).toBe("failed");
    expect(github.impl.calls.some((c) => c.method === "createPullRequest")).toBe(false);
  });

  it("leaves review-handoff.md with its phase details and global file reconciliation", async () => {
    const { fs, git, layers } = setupLayers();
    const info = makeInfo({
      phaseStatuses: [makePhaseStatus("phase-01", 0)],
      planPhases: [{ id: "phase-01", title: "Greeting" }],
    });
    fs.impl.setFile(
      `${runPath}/phase-01/file-reconciliation.json`,
      JSON.stringify(
        encodePhaseFileReconciliation({
          phaseId: "phase-01",
          ...reconciliationResult({
            createdAsPlanned: ["src/greet.ts"],
            unplannedCreated: ["src/colors.ts"],
            hasDeviations: true,
          }),
        }),
      ),
    );
    fs.impl.setFile(`${runPath}/phase-01/file-reconciliation.md`, "Greeting reconciliation.");
    fs.impl.setFile(`${runPath}/phase-01/phase-handoff.md`, "Greeting handoff.");
    fs.impl.setFile(`${runPath}/run-status.json`, runStatusJson());
    git.impl.addExistingBranch(finalBranch);
    git.impl.addExistingRemote("origin");
    await Effect.runPromise(
      generateReviewHandoff(info, { allowPartial: false }).pipe(Effect.provide(layers)),
    );

    await Effect.runPromise(
      publishRun(info, defaultConfig(), { repoRoot, now: constNow }).pipe(Effect.provide(layers)),
    );

    const handoff = fs.impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("## Phase details");
    expect(handoff).toContain("#### File reconciliation\n\nGreeting reconciliation.");
    expect(handoff).toContain("#### Phase handoff\n\nGreeting handoff.");
    expect(handoff).toContain("## Global File Reconciliation");

    const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
    expect(body).toContain("- `phase-01` Greeting — not reviewed · 1 deviation, 1 unexplained");
    expect(body).not.toContain("## Phase details");
    expect(body).not.toContain("Global File Reconciliation");
    expect(body).not.toContain("Greeting handoff.");
  });
});
