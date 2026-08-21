import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, type GitError } from "../../src/ports/git.js";
import { decodeBranchName, type BranchName } from "../../src/domain/branded.js";
import { computeRecordsPending } from "../../src/app/recordsStatus.js";
import { pushRecordsAtPublish } from "../../src/app/recordsSync.js";
import { publishRun } from "../../src/app/publishRun.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { ResolvedPublishConfig } from "../../src/schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";

const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName("phax/records/v1"));

function execGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function run<A>(effect: Effect.Effect<A, GitError, Git>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, NodeGitLayer));
}

function writeRecordCommit(repo: string, runId: string, phaseId: string, seed: string) {
  return run(
    Effect.flatMap(Git, (g) =>
      g.writeTreeCommit({
        repo,
        branch: RECORDS_BRANCH,
        message: `records(${phaseId}): committed`,
        files: [
          {
            path: `${runId}/${phaseId}/record.json`,
            content: new TextEncoder().encode(`{"seed":"${seed}"}\n`),
          },
        ],
      }),
    ),
  );
}

const IN_REPO_CONFIG: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: true,
};

describe("records push and pending status (real git)", () => {
  let repoDir: string;
  let remoteDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-records-push-repo-"));
    remoteDir = mkdtempSync(join(tmpdir(), "phax-records-push-remote-"));
    execGit(["init"], repoDir);
    execGit(["config", "--local", "user.email", "test@phax.test"], repoDir);
    execGit(["config", "--local", "user.name", "phax test"], repoDir);
    execGit(["init", "--bare"], remoteDir);
    execGit(["remote", "add", "origin", remoteDir], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("a run's records are committed locally and absent from the remote until pushed", async () => {
    await writeRecordCommit(repoDir, "run-1", "phase-01", "a");
    await writeRecordCommit(repoDir, "run-1", "phase-02", "b");

    const before = await run(
      computeRecordsPending({
        records: IN_REPO_CONFIG,
        repoRoot: repoDir,
        publishRemote: "origin",
      }),
    );
    expect(before.pending.toSorted((a, b) => a.phaseId.localeCompare(b.phaseId))).toEqual([
      { runId: "run-1", phaseId: "phase-01" },
      { runId: "run-1", phaseId: "phase-02" },
    ]);

    const pushResult = await run(
      pushRecordsAtPublish({ records: IN_REPO_CONFIG, repoRoot: repoDir, publishRemote: "origin" }),
    );
    expect(pushResult).toEqual({ kind: "pushed", remote: "origin", path: repoDir });

    const after = await run(
      computeRecordsPending({
        records: IN_REPO_CONFIG,
        repoRoot: repoDir,
        publishRemote: "origin",
      }),
    );
    expect(after.pending).toEqual([]);
  });

  it("only a later, unpushed phase is reported pending after an earlier push", async () => {
    await writeRecordCommit(repoDir, "run-1", "phase-01", "a");
    await run(
      pushRecordsAtPublish({ records: IN_REPO_CONFIG, repoRoot: repoDir, publishRemote: "origin" }),
    );

    await writeRecordCommit(repoDir, "run-1", "phase-02", "b");
    const pending = await run(
      computeRecordsPending({
        records: IN_REPO_CONFIG,
        repoRoot: repoDir,
        publishRemote: "origin",
      }),
    );
    expect(pending.pending).toEqual([{ runId: "run-1", phaseId: "phase-02" }]);
  });

  it("an unreachable remote leaves the push failed and the records pending", async () => {
    await writeRecordCommit(repoDir, "run-1", "phase-01", "a");
    execGit(
      ["remote", "set-url", "origin", join(tmpdir(), "phax-records-push-does-not-exist")],
      repoDir,
    );

    const pushResult = await run(
      pushRecordsAtPublish({ records: IN_REPO_CONFIG, repoRoot: repoDir, publishRemote: "origin" }),
    );
    expect(pushResult.kind).toBe("failed");

    const pending = await run(
      computeRecordsPending({
        records: IN_REPO_CONFIG,
        repoRoot: repoDir,
        publishRemote: "origin",
      }),
    );
    expect(pending.pending).toEqual([{ runId: "run-1", phaseId: "phase-01" }]);
  });

  it("pushes to the local clone's origin for a dedicated repo destination", async () => {
    const cloneDir = mkdtempSync(join(tmpdir(), "phax-records-push-clone-"));
    await rm(cloneDir, { recursive: true, force: true });
    execGit(["clone", "--", remoteDir, cloneDir], tmpdir());
    // A fresh clone inherits no committer identity, and CI runners set none
    // globally; configure it locally like every other repo this suite commits
    // into, so `commit-tree` does not fail with "empty ident name".
    execGit(["config", "--local", "user.email", "test@phax.test"], cloneDir);
    execGit(["config", "--local", "user.name", "phax test"], cloneDir);
    await writeRecordCommit(cloneDir, "run-2", "phase-01", "c");

    const repoRecords: ResolvedRecordsConfig = {
      enabled: true,
      transcript: true,
      destination: { kind: "repo", remote: remoteDir },
      autoPush: true,
    };

    const pushResult = await run(
      pushRecordsAtPublish({
        records: repoRecords,
        repoRoot: repoDir,
        publishRemote: "origin",
        recordsClonePath: cloneDir,
      }),
    );
    expect(pushResult).toEqual({ kind: "pushed", remote: "origin", path: cloneDir });

    const pending = await run(
      computeRecordsPending({
        records: repoRecords,
        repoRoot: repoDir,
        publishRemote: "origin",
        recordsClonePath: cloneDir,
      }),
    );
    expect(pending.pending).toEqual([]);

    await rm(cloneDir, { recursive: true, force: true });
  });

  it("does not push and reports nothing pending when records are disabled", async () => {
    const off: ResolvedRecordsConfig = {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    };
    const pushResult = await run(
      pushRecordsAtPublish({ records: off, repoRoot: repoDir, publishRemote: "origin" }),
    );
    expect(pushResult).toEqual({ kind: "not-configured" });

    const pending = await run(
      computeRecordsPending({ records: off, repoRoot: repoDir, publishRemote: "origin" }),
    );
    expect(pending).toEqual({
      configured: false,
      destination: { kind: "in-repo" },
      localPath: repoDir,
      remote: "",
      pending: [],
    });
  });
});

// --- publishRun wiring: does a "published" run actually push records? ---

const stateRoot = "/fake-state";
const shortName = "test-run";
const publishRunPath = `${stateRoot}/runs/${shortName}`;
const publishRepoRoot = "/fake-repo";
const finalBranch = "feature/test-run--phase-01" as BranchName;
const now = "2026-06-12T12:00:00.000Z";
const constNow = () => now;

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
    runPath: publishRunPath,
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

function defaultPublishConfig(
  overrides: Partial<ResolvedPublishConfig> = {},
): ResolvedPublishConfig {
  return {
    auto: true,
    remote: "origin",
    provider: "github",
    pushBranch: true,
    createPullRequest: true,
    ...overrides,
  };
}

function setupPublishLayers() {
  const fs = makeFakeFileSystem();
  const git = makeFakeGit();
  const github = makeFakeGitHub();
  const layers = Layer.mergeAll(fs.layer, git.layer, github.layer, NoopSystemTelemetryLayer);
  return { fs, git, github, layers };
}

function seedPublishPreconditions(args: {
  fs: ReturnType<typeof makeFakeFileSystem>;
  git: ReturnType<typeof makeFakeGit>;
}) {
  args.fs.impl.setFile(
    `${publishRunPath}/review-handoff.md`,
    "# Review Handoff\n\nSentinel content.",
  );
  args.git.impl.addExistingBranch(finalBranch);
  args.git.impl.addExistingRemote("origin");
}

describe("publishRun: records push wiring", () => {
  it("does not push records when records opts are absent", async () => {
    const { fs, git, github, layers } = setupPublishLayers();
    seedPublishPreconditions({ fs, git });
    github.impl.setCreatedPrUrl("https://github.com/owner/repo/pull/1");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultPublishConfig(), {
        repoRoot: publishRepoRoot,
        now: constNow,
      }).pipe(Effect.provide(layers)),
    );

    expect(result.kind).toBe("published");
    expect(
      git.impl.calls.some((c) => c.method === "pushBranch" && c.branch === "phax/records/v1"),
    ).toBe(false);
  });

  it("does not push records when autoPush is off", async () => {
    const { fs, git, github, layers } = setupPublishLayers();
    seedPublishPreconditions({ fs, git });

    const records: ResolvedRecordsConfig = {
      enabled: true,
      transcript: true,
      destination: { kind: "in-repo" },
      autoPush: false,
    };

    await Effect.runPromise(
      publishRun(
        makeInfo(),
        defaultPublishConfig({ pushBranch: false, createPullRequest: false }),
        { repoRoot: publishRepoRoot, now: constNow, records },
      ).pipe(Effect.provide(layers)),
    );

    expect(
      git.impl.calls.some((c) => c.method === "pushBranch" && c.branch === "phax/records/v1"),
    ).toBe(false);
  });

  it("pushes records to the source repo's publish remote for an in-repo destination", async () => {
    const { fs, git, github, layers } = setupPublishLayers();
    seedPublishPreconditions({ fs, git });

    const records: ResolvedRecordsConfig = {
      enabled: true,
      transcript: true,
      destination: { kind: "in-repo" },
      autoPush: true,
    };

    const result = await Effect.runPromise(
      publishRun(
        makeInfo(),
        defaultPublishConfig({ pushBranch: false, createPullRequest: false }),
        { repoRoot: publishRepoRoot, now: constNow, records },
      ).pipe(Effect.provide(layers)),
    );

    expect(result.kind).toBe("published");
    const call = git.impl.calls.find(
      (c) => c.method === "pushBranch" && c.branch === "phax/records/v1",
    );
    expect(call).toMatchObject({ remote: "origin", repo: publishRepoRoot });
  });

  it("pushes records to the local clone's origin for a dedicated repo destination", async () => {
    const { fs, git, github, layers } = setupPublishLayers();
    seedPublishPreconditions({ fs, git });

    const records: ResolvedRecordsConfig = {
      enabled: true,
      transcript: true,
      destination: { kind: "repo", remote: "https://example.com/acme-records.git" },
      autoPush: true,
    };

    const result = await Effect.runPromise(
      publishRun(
        makeInfo(),
        defaultPublishConfig({ pushBranch: false, createPullRequest: false }),
        {
          repoRoot: publishRepoRoot,
          now: constNow,
          records,
          recordsClonePath: "/fake-records-clone",
        },
      ).pipe(Effect.provide(layers)),
    );

    expect(result.kind).toBe("published");
    const call = git.impl.calls.find(
      (c) => c.method === "pushBranch" && c.branch === "phax/records/v1",
    );
    expect(call).toMatchObject({ remote: "origin", repo: "/fake-records-clone" });
  });

  it("a records push failure leaves the publish result successful", async () => {
    const { fs, git, github, layers } = setupPublishLayers();
    seedPublishPreconditions({ fs, git });
    git.impl.failNextPushBranch("remote rejected");

    const records: ResolvedRecordsConfig = {
      enabled: true,
      transcript: true,
      destination: { kind: "in-repo" },
      autoPush: true,
    };

    const result = await Effect.runPromise(
      publishRun(
        makeInfo(),
        defaultPublishConfig({ pushBranch: false, createPullRequest: false }),
        { repoRoot: publishRepoRoot, now: constNow, records },
      ).pipe(Effect.provide(layers)),
    );

    expect(result.kind).toBe("published");
    expect(git.impl.pushedBranches.has("phax/records/v1")).toBe(false);
  });
});
