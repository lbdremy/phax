// The headless code review keeps its code-review.json as a review entry on
// phax/records/v1 (spec headless-code-review §5.23): one commit under the run's
// `code-review` key beside the phase records, replaced by a later review with
// the first still in the branch's history, and nothing at all with records off.
// Real git in a temporary repository; nothing reaches GitHub or a provider.
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECORDS_BRANCH_NAME } from "../../src/app/recordPlumbing.js";
import { reviewCodeAndRecord } from "../../src/app/reviewCode.js";
import { reviewEntryNotice, reviewEntryWarnings } from "../../src/app/reviewEntry.js";
import type { BranchName, ClaudeSessionId } from "../../src/domain/branded.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const RUN_ID = "2610270900-by-hand";
const KEY = `${RUN_ID}/code-review`;

const RECORDS: ResolvedRecordsConfig = {
  enabled: true,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const resolution: RoutingResolution = {
  requested: { model: "claude-opus-5-5", family: "claude-opus", effort: "high" },
  selected: {
    provider: "claude-code",
    family: "claude-opus",
    concreteModel: "claude-opus-5-5",
    thinking: "high",
  },
  relationship: "exact",
  reason: "exact match",
};

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

function answerWith(message: string): string {
  return JSON.stringify({
    version: 1,
    findings: [
      {
        severity: "concern",
        file: "src/example.ts",
        line: 7,
        message,
        lens: "core",
        escape: "omission",
        criterion: null,
        suggestion: "Cover it with a test.",
      },
    ],
  });
}

function runGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

describe("code review entry (real git)", () => {
  let restoreGit: () => void;
  let repoDir: string;
  let runPath: string;
  let worktreePath: string;
  const fakeGitHub = makeFakeGitHub();

  beforeEach(async () => {
    restoreGit = isolateGit();
    fakeGitHub.impl.setVisibility("private");
    repoDir = mkdtempSync(join(tmpdir(), "phax-code-review-repo-"));
    runGit(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    runGit(["config", "--local", "user.email", "test@phax.test"], repoDir);
    runGit(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    runGit(["add", "."], repoDir);
    runGit(["commit", "-m", "chore: initial commit"], repoDir);

    runPath = mkdtempSync(join(tmpdir(), "phax-code-review-run-"));
    // The review snapshots its worktree before and after the session.
    worktreePath = mkdtempSync(join(tmpdir(), "phax-code-review-wt-"));
    runGit(["worktree", "add", "-b", "phax/by-hand", worktreePath], repoDir);
  });

  afterEach(() => {
    for (const dir of [repoDir, runPath, worktreePath]) removeTempDir(dir);
    restoreGit();
  });

  function info(): RunReviewInfo {
    return {
      namespace: "test-project",
      shortName: "by-hand",
      runId: RUN_ID,
      runState: "review_open",
      branch: "feature/by-hand",
      runTitle: "By Hand",
      finalPhaseBranch: "feature/by-hand--phase-01" as BranchName,
      stateRoot: "/unused",
      runPath,
      finalPhaseId: "phase-01",
      finalPhaseTitle: "Phase One",
      worktreePath,
      claudeSessionId: undefined,
      gateProfileId: "full",
      phaseStatuses: [],
      planPhases: [{ id: "phase-01", title: "Phase One" }],
      updatedAt: "2026-10-27T12:00:00.000Z",
      stoppedReason: undefined,
      lastError: undefined,
    };
  }

  function review(message: string, records: ResolvedRecordsConfig = RECORDS) {
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: `session-${message}` as ClaudeSessionId,
      outputPath: "",
      finalText: answerWith(message),
    });
    const layers = Layer.mergeAll(
      backend.layer,
      NodeFileSystemLayer,
      NodeGitLayer,
      NoopSystemTelemetryLayer,
      fakeGitHub.layer,
    );
    return Effect.runPromise(
      reviewCodeAndRecord(
        info(),
        { enabled: false, model: "claude-opus-5-5", effort: "high" },
        resolution,
        security,
        { kind: "project", records, repoRoot: repoDir, push: null },
        { bundledReviewSkill: "# phax review\n", nowIso: "2026-10-27T12:30:00.000Z" },
      ).pipe(Effect.provide(layers)),
    );
  }

  it("commits the run's code-review.json byte for byte under the run's code-review key", async () => {
    const outcome = await review("first");
    expect(outcome.review.kind).toBe("accepted");
    expect(outcome.record.kind).toBe("written");
    expect(outcome.push.kind).toBe("left-to-publish");

    const runFile = await readFile(join(runPath, "code-review.json"), "utf8");
    expect(runGit(["show", `${RECORDS_BRANCH_NAME}:${KEY}/code-review.json`], repoDir)).toBe(
      runFile,
    );
    const manifest = JSON.parse(
      runGit(["show", `${RECORDS_BRANCH_NAME}:${KEY}/record.json`], repoDir),
    ) as { review?: string };
    expect(manifest.review).toBe("code-review");
    expect(reviewEntryNotice(outcome)).toMatch(new RegExp(`^Recorded: ${KEY} \\(`));
    expect(reviewEntryWarnings(outcome, "code-review", "phax review-code by-hand")).toEqual([]);
  });

  it("replaces the entry on a second review and keeps the first in the branch's history", async () => {
    await review("first");
    await review("second");

    const commits = runGit(["rev-list", "--reverse", RECORDS_BRANCH_NAME], repoDir)
      .trim()
      .split("\n");
    expect(commits).toHaveLength(2);
    const messageAt = (commit: string): string =>
      (
        JSON.parse(runGit(["show", `${commit}:${KEY}/code-review.json`], repoDir)) as {
          findings: ReadonlyArray<{ message: string }>;
        }
      ).findings[0]?.message ?? "";
    expect(messageAt(commits[0] ?? "")).toBe("first");
    expect(messageAt(commits[1] ?? "")).toBe("second");
    expect(JSON.parse(await readFile(join(runPath, "code-review.json"), "utf8")).findings).toEqual([
      expect.objectContaining({ message: "second" }),
    ]);
  });

  it("records nothing with records off: only the run folder holds the review", async () => {
    const outcome = await review("off", { ...RECORDS, enabled: false });
    expect(outcome.review.kind).toBe("accepted");
    expect(outcome.record.kind).toBe("records-off");
    expect(runGit(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
    expect((await readFile(join(runPath, "code-review.json"), "utf8")).length).toBeGreaterThan(0);
  });

  it("records no entry for a refused answer", async () => {
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: "session-bad" as ClaudeSessionId,
      outputPath: "",
      finalText: '{"version":1}',
    });
    const outcome = await Effect.runPromise(
      reviewCodeAndRecord(
        info(),
        { enabled: false, model: "claude-opus-5-5", effort: "high" },
        resolution,
        security,
        { kind: "project", records: RECORDS, repoRoot: repoDir, push: null },
        { bundledReviewSkill: "# phax review\n", nowIso: "2026-10-27T12:30:00.000Z" },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            backend.layer,
            NodeFileSystemLayer,
            NodeGitLayer,
            NoopSystemTelemetryLayer,
            fakeGitHub.layer,
          ),
        ),
      ),
    );
    expect(outcome.review.kind).toBe("failed");
    expect(outcome.record.kind).toBe("no-entry");
    expect(outcome.push.kind).toBe("no-record");
    expect(runGit(["branch", "--list", RECORDS_BRANCH_NAME], repoDir).trim()).toBe("");
  });
});
