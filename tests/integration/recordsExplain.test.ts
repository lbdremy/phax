import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Git, type GitError } from "../../src/ports/git.js";
import { Shell, type ShellError } from "../../src/ports/shell.js";
import { decodeBranchName, type BranchName } from "../../src/domain/branded.js";
import { explainRecord } from "../../src/app/recordsExplain.js";
import { listRecords } from "../../src/app/recordsList.js";
import { encodeRunRecordManifest, type RunRecordManifest } from "../../src/schemas/runRecord.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";

const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName("phax/records/v1"));
const LAYER = Layer.mergeAll(NodeGitLayer, NodeShellLayer);

function execGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function run<A>(effect: Effect.Effect<A, GitError | ShellError, Git | Shell>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, LAYER));
}

function runGitOnly<A>(effect: Effect.Effect<A, GitError, Git>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, NodeGitLayer));
}

const IN_REPO_CONFIG: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: true,
};

function commitWithTrailers(repo: string, runId: string, phaseId: string): string {
  const body = [
    "Do the thing.",
    "",
    "---",
    "",
    `Run-Id: ${runId}`,
    "Short-Name: test-run",
    `Phase-Id: ${phaseId}`,
    "Phase-Title: Test phase",
    "Model: claude-sonnet-5",
    "Effort: high",
  ].join("\n");
  execGit(["commit", "--allow-empty", "-m", `feat: ${phaseId}`, "-m", body], repo);
  return execGit(["rev-parse", "HEAD"], repo).trim();
}

function writeFullRecordCommit(
  repo: string,
  manifest: RunRecordManifest,
  extraFiles: Record<string, string>,
): Promise<string> {
  const key = `${manifest.runId}/${manifest.phaseId}`;
  const files = Object.entries(extraFiles).map(([name, content]) => ({
    path: `${key}/${name}`,
    content: new TextEncoder().encode(content),
  }));
  files.push({
    path: `${key}/record.json`,
    content: new TextEncoder().encode(
      `${JSON.stringify(encodeRunRecordManifest(manifest), null, 2)}\n`,
    ),
  });
  return runGitOnly(
    Effect.flatMap(Git, (g) =>
      g.writeTreeCommit({
        repo,
        branch: RECORDS_BRANCH,
        message: [
          `records(${manifest.phaseId}): ${manifest.outcome}`,
          "",
          `Run-Id: ${manifest.runId}`,
          `Phase-Id: ${manifest.phaseId}`,
          `Shape: ${manifest.shape}`,
        ].join("\n"),
        files,
      }),
    ),
  );
}

describe("records explain and list (real git)", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-records-explain-repo-"));
    execGit(["init"], repoDir);
    execGit(["config", "--local", "user.email", "test@phax.test"], repoDir);
    execGit(["config", "--local", "user.name", "phax test"], repoDir);
    execGit(["commit", "--allow-empty", "-m", "chore: initial commit"], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("resolves a record through the commit's Run-Id/Phase-Id trailers, surviving a rebase", async () => {
    const runId = "run-rebase-1786800000000";
    const phaseId = "phase-01";
    const original = commitWithTrailers(repoDir, runId, phaseId);

    const manifest: RunRecordManifest = {
      version: 1,
      runId,
      phaseId,
      shape: "full",
      sourceSha: original,
      model: "claude-sonnet-5",
      effort: "high",
      provider: "claude-code",
      outcome: "committed",
      usage: {
        available: true,
        usage: {
          provider: "claude-code",
          inputTokens: 41203,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 8117,
          totalCostUsd: 1.23,
        },
      },
    };
    await writeFullRecordCommit(repoDir, manifest, {
      "prompt.md": "a".repeat(100),
      "diff.patch": [
        "diff --git a/x.ts b/x.ts",
        "--- a/x.ts",
        "+++ b/x.ts",
        "+added line",
        "-removed line",
      ].join("\n"),
      "phase-handoff.md": "handoff content",
      "checks-attempt-01.log": "gate log 1",
      "checks-attempt-02.log": "gate log 2",
      "output.jsonl": '{"type":"result"}\n',
    });

    // Simulate a rebase: a new commit with the same trailers, a different sha.
    const rebased = commitWithTrailers(repoDir, runId, phaseId);
    expect(rebased).not.toBe(original);

    const outcome = await run(
      explainRecord({
        sha: rebased,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") throw new Error("expected found");
    expect(outcome.record.runId).toBe(runId);
    expect(outcome.record.phaseId).toBe(phaseId);
    expect(outcome.record.manifest.shape).toBe("full");
    expect(outcome.record.checksAttemptCount).toBe(2);
    expect(outcome.record.handoffPresent).toBe(true);
    expect(outcome.record.promptByteLength).toBe(100);
    expect(outcome.record.diffStat).toEqual({ files: 1, insertions: 1, deletions: 1 });
    // The manifest's own back-reference is the original commit, still reachable here.
    expect(outcome.record.sourceCommitReachable).toBe(true);
  });

  it("reports a hand-written commit with no trailers as not produced by a phax phase", async () => {
    execGit(["commit", "--allow-empty", "-m", "manual: hotfix, no trailers"], repoDir);
    const sha = execGit(["rev-parse", "HEAD"], repoDir).trim();

    const outcome = await run(
      explainRecord({
        sha,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("not-phax-commit");
  });

  it("reports a local miss with an unreachable remote as offline, never as absence", async () => {
    const runId = "run-offline-1786800000001";
    const phaseId = "phase-02";
    const sha = commitWithTrailers(repoDir, runId, phaseId);
    // No record commit is ever written on this repo's own records branch.
    execGit(
      ["remote", "add", "origin", join(tmpdir(), "phax-records-explain-no-such-remote")],
      repoDir,
    );

    const outcome = await run(
      explainRecord({
        sha,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("not-found");
    if (outcome.kind !== "not-found") throw new Error("expected not-found");
    expect(outcome.remoteConsulted).toBe(false);
  });

  it("reports a skeleton record's shape and a vibe phase's captured usage", async () => {
    const runId = "run-vibe-1786800000002";
    const phaseId = "phase-03";
    const sha = commitWithTrailers(repoDir, runId, phaseId);

    const manifest: RunRecordManifest = {
      version: 1,
      runId,
      phaseId,
      shape: "skeleton",
      sourceSha: sha,
      model: "mistral-large",
      effort: "medium",
      provider: "mistral-vibe",
      outcome: "committed",
      usage: {
        available: true,
        usage: {
          provider: "mistral-vibe",
          inputTokens: 5000,
          outputTokens: 900,
          sessionCostUsd: 0.42,
          toolCallsAgreed: 3,
          toolCallsRejected: 0,
          toolCallsFailed: 0,
          toolCallsSucceeded: 3,
        },
      },
    };
    await writeFullRecordCommit(repoDir, manifest, {
      "prompt.md": "prompt",
      "diff.patch": "diff --git a/y.ts b/y.ts\n",
      "checks-attempt-01.log": "gate log",
    });

    const outcome = await run(
      explainRecord({
        sha,
        repoRoot: repoDir,
        records: IN_REPO_CONFIG,
        publishRemote: "origin",
      }),
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") throw new Error("expected found");
    expect(outcome.record.manifest.shape).toBe("skeleton");
    expect(outcome.record.artifacts.has("output.jsonl")).toBe(false);
    expect(outcome.record.manifest.usage).toEqual(manifest.usage);
  });

  it("records list shows a failed phase's record", async () => {
    const runId = "run-list-1786800000003";
    const failedManifest: RunRecordManifest = {
      version: 1,
      runId,
      phaseId: "phase-04",
      shape: "skeleton",
      model: "claude-sonnet-5",
      effort: "high",
      provider: "claude-code",
      outcome: "failed",
      usage: { available: false },
    };
    await writeFullRecordCommit(repoDir, failedManifest, {
      "checks-attempt-01.log": "log",
      "checks-attempt-02.log": "log",
      "checks-attempt-03.log": "log",
    });

    const committedManifest: RunRecordManifest = {
      ...failedManifest,
      phaseId: "phase-05",
      outcome: "committed",
      sourceSha: commitWithTrailers(repoDir, runId, "phase-05"),
    };
    await writeFullRecordCommit(repoDir, committedManifest, { "checks-attempt-01.log": "log" });

    const result = await run(
      listRecords({
        records: IN_REPO_CONFIG,
        repoRoot: repoDir,
        publishRemote: "origin",
        runId,
      }),
    );

    expect(result.kind).toBe("listed");
    if (result.kind !== "listed") throw new Error("expected listed");
    const byPhase = new Map(result.records.map((r) => [r.phaseId, r]));
    expect(byPhase.get("phase-04")?.outcome).toBe("failed");
    expect(byPhase.get("phase-05")?.outcome).toBe("committed");
  });
});
