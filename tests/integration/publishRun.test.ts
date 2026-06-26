import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { publishRun } from "../../src/app/publishRun.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { ResolvedPublishConfig } from "../../src/schemas/phaxConfig.js";

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

function seedSuccessPreconditions(args: {
  fs: ReturnType<typeof makeFakeFileSystem>;
  git: ReturnType<typeof makeFakeGit>;
  handoffMd?: string;
}) {
  args.fs.impl.setFile(
    `${runPath}/review-handoff.md`,
    args.handoffMd ?? "# Review Handoff\n\nSentinel content.",
  );
  args.git.impl.addExistingBranch(finalBranch);
  args.git.impl.addExistingRemote("origin");
}

const constNow = () => now;

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
    const { fs, git, github, layers } = setupLayers();
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

  it("includes compliance section in PR body when compliance-review.md exists, before phase details", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    github.impl.setCreatedPrUrl("https://github.com/owner/repo/pull/42");

    const complianceMd = "## Verdict\n\nconformant\n\nAll phases passed.";
    fs.impl.setFile(`${runPath}/compliance-review.md`, complianceMd);

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    const prBodyFile = fs.impl.getFile(`${runPath}/pr-body.md`);
    expect(prBodyFile).toBeDefined();
    expect(prBodyFile).toContain("## Plan compliance review");
    expect(prBodyFile).toContain(complianceMd);
    const complianceIdx = prBodyFile!.indexOf("## Plan compliance review");
    const phaseDetailsIdx = prBodyFile!.indexOf("## Phase details");
    expect(complianceIdx).toBeGreaterThanOrEqual(0);
    expect(phaseDetailsIdx).toBeGreaterThan(complianceIdx);
  });

  it("PR body is unchanged when compliance-review.md is absent", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    github.impl.setCreatedPrUrl("https://github.com/owner/repo/pull/42");

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), { repoRoot, now: constNow }).pipe(
        Effect.provide(layers),
      ),
    );

    const prBodyFile = fs.impl.getFile(`${runPath}/pr-body.md`);
    expect(prBodyFile).toBeDefined();
    expect(prBodyFile).not.toContain("## Plan compliance review");
  });
});
