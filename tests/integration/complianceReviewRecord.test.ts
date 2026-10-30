// The compliance review keeps its compliance-review.json as a review entry on
// phax/records/v1 (spec headless-code-review §5.24, §5.26): at run end beside
// the phase records and before publish, by hand with a push, and a records
// failure never fails the review. Run-end tests drive executePlan with fake
// ports; the by-hand tests use real git, a temporary repository and a bare
// remote. Nothing reaches GitHub: every test uses makeFakeGitHub().
import { Effect, Either, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { loadConfig } from "../../src/app/loadConfig.js";
import { reviewComplianceAndRecord } from "../../src/app/reviewCompliance.js";
import {
  reviewEntryWarnings,
  reviewRecordTargetFor,
  type ReviewRecordTarget,
  type ReviewRecordUnresolved,
} from "../../src/app/reviewEntry.js";
import { RECORDS_BRANCH_NAME } from "../../src/app/recordPlumbing.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import {
  decodeShortName,
  type BranchName,
  type ClaudeSessionId,
} from "../../src/domain/branded.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const COMPLIANCE_AGENT_JSON = JSON.stringify({
  $schema: schemaUrl("compliance-review", CURRENT_STAMPS["compliance-review"]),
  verdict: "conformant",
  summary: "All phases conformed.",
  perPhase: [{ phaseId: "phase-01", verdict: "conformant", findings: [] }],
  unplannedChanges: [],
  unmetPromises: [],
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
const SHORT_NAME = "review-entry-run";
const GATE = "node scripts/example-check.mjs";
const shortName = Either.getOrThrow(decodeShortName(SHORT_NAME));

const RECORDS: ResolvedRecordsConfig = {
  enabled: true,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

function recordCommits(fake: ReturnType<typeof makeFakeGit>) {
  return fake.impl.calls.flatMap((call) =>
    call.method === "writeTreeCommit" ? [{ message: call.message, paths: call.paths }] : [],
  );
}

describe("compliance review entry at run end", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-compliance-entry-"));
    const worktree = worktreeOf();
    await mkdir(join(worktree, ".phax-context"), { recursive: true });
    await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(stateRoot, { recursive: true, force: true });
  });

  function worktreeOf(): string {
    return join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, "phase-01");
  }

  function makeConfig(): ResolvedConfig {
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
      publish: resolvePublishConfig(undefined),
      complianceReview: { enabled: true, model: "claude-sonnet-5", effort: "medium" },
      codeReview: resolveCodeReviewConfig(undefined),
      authoring: resolveAuthoringConfig(undefined),
    };
  }

  /**
   * One run with the compliance review on. `review` is what the review session
   * answers: a valid answer, or prose that its corrective resume does not fix;
   * `onReview` runs when its session starts.
   */
  async function runOnce(opts: {
    readonly review: "accepted" | "refused-twice";
    readonly onReview?: (git: ReturnType<typeof makeFakeGit>) => void;
  }) {
    const plan = Either.getOrThrow(
      liftFixturePhaxPlanToCurrent("phax-plan.json", {
        version: 1,
        run: {
          shortName: SHORT_NAME,
          title: "Review Entry Run",
          branch: "ai/review-entry-run",
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
    const config = makeConfig();

    const git = makeFakeGit();
    git.impl.setRepoIsClean(true);
    git.impl.enqueueWorktreeIsClean(worktreeOf(), false);
    const shell = makeFakeShell();
    shell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    shell.impl.setResponse(GATE, { exitCode: 0, stdout: "ok", stderr: "" });
    shell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    shell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });
    const backend = makeFakeBackend();
    backend.impl.setOnRunAgent((_prompt, options) => {
      const stream = options.outputJsonlPath ?? "";
      if (!stream.endsWith("compliance-review.session.jsonl")) return;
      opts.onReview?.(git);
    });
    backend.impl.addRunResponse({
      sessionId: "session-phase-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    backend.impl.addRunResponse({
      sessionId: "session-review" as ClaudeSessionId,
      outputPath: "",
      finalText: opts.review === "accepted" ? COMPLIANCE_AGENT_JSON : "Prose, not JSON.",
    });
    // The phase's handoff resume comes first, then the review's corrective one.
    backend.impl.addResumeResponse({
      sessionId: "session-phase-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    if (opts.review === "refused-twice") {
      backend.impl.addResumeResponse({
        sessionId: "session-review" as ClaudeSessionId,
        outputPath: "",
        finalText: "More prose, still not JSON.",
      });
    }
    const layers = Layer.mergeAll(
      git.layer,
      shell.layer,
      backend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
      makeFakeGitHub().layer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, config).pipe(Effect.provide(layers)),
    );
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
        }).pipe(Effect.provide(layers)),
      ),
    );
    return { git, runPath, runId: runId as string, outcome, stderr: stderr.join("") };
  }

  it("commits the generated compliance-review.json as an entry after the phase records", async () => {
    const { git, runPath, runId, outcome } = await runOnce({ review: "accepted" });
    expect(Either.isRight(outcome)).toBe(true);

    const commits = recordCommits(git);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.paths.every((path) => path.startsWith(`${runId}/phase-01/`))).toBe(true);
    expect(commits[1]?.paths).toEqual([
      `${runId}/compliance-review/compliance-review.json`,
      `${runId}/compliance-review/record.json`,
    ]);
    expect(commits[1]?.message).toBe(
      `records(review): compliance-review\n\nRun-Id: ${runId}\nReview: compliance-review`,
    );
    expect(
      (await readFile(join(runPath, "compliance-review.json"), "utf8")).length,
    ).toBeGreaterThan(0);
  });

  it("leaves the file in the run folder, the run in review_open and a warning when the commit fails", async () => {
    const { git, runPath, runId, outcome, stderr } = await runOnce({
      review: "accepted",
      onReview: (fake) => fake.impl.failNextWriteTreeCommit("disk full"),
    });
    expect(Either.isRight(outcome)).toBe(true);

    const state = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      readonly state?: string;
    };
    expect(state.state).toBe("review_open");
    expect(
      (await readFile(join(runPath, "compliance-review.json"), "utf8")).length,
    ).toBeGreaterThan(0);
    // The attempt is logged, but no commit exists for it.
    expect(
      [...git.impl.fakeCommits.values()].some((c) => c.message.startsWith("records(review)")),
    ).toBe(false);
    expect(stderr).toContain("[phax] Warning: the compliance-review entry was not committed");
    expect(stderr).toContain("it is pending");
    expect(runId).not.toBe("");
  });

  it("commits no entry, writes no file and warns when the review is refused twice, and the run stays in review_open", async () => {
    const { git, runPath, outcome, stderr } = await runOnce({ review: "refused-twice" });
    expect(Either.isRight(outcome)).toBe(true);
    expect(recordCommits(git)).toHaveLength(1);

    const state = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      readonly state?: string;
    };
    expect(state.state).toBe("review_open");
    expect(existsSync(join(runPath, "compliance-review.json"))).toBe(false);
    expect(existsSync(join(runPath, "compliance-review.md"))).toBe(false);
    // The refusal is printed before the resume; the failure, then, names the retry command.
    expect(stderr).toContain("[phax] Warning: compliance-review answer refused");
    expect(stderr).toContain(
      `[phax] Warning: compliance review failed: compliance-review answer rejected twice`,
    );
    expect(stderr).toContain(`rerun it with \`phax review-compliance ${SHORT_NAME}\``);
    // No earlier review was there to keep.
    expect(stderr).not.toContain("earlier review is kept");
    expect(stderr).not.toContain("unknown");
  });
});

/** A project's phax.json with in-repo records that push. */
function phaxJson(name: string): string {
  return JSON.stringify({
    version: 1,
    name,
    gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    records: { transcript: false, destination: { kind: "in-repo" }, autoPush: true },
  });
}

function runGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

describe("compliance review entry by hand (real git)", () => {
  let restoreGit: () => void;
  let repoDir: string;
  let remoteDir: string;
  let runPath: string;
  let worktreePath: string;

  const fakeGitHub = makeFakeGitHub();
  const resolution: RoutingResolution = {
    requested: { model: "claude-sonnet-4-6", family: "claude-sonnet", effort: "medium" },
    selected: {
      provider: "claude-code",
      family: "claude-sonnet",
      concreteModel: "claude-sonnet-4-6",
      thinking: "medium",
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

  beforeEach(async () => {
    restoreGit = isolateGit();
    fakeGitHub.impl.setVisibility("private");
    repoDir = mkdtempSync(join(tmpdir(), "phax-compliance-hand-repo-"));
    remoteDir = mkdtempSync(join(tmpdir(), "phax-compliance-hand-remote-"));
    runGit(["init", "--bare"], remoteDir);
    runGit(["init"], repoDir);
    disableGitAutoMaintenance(repoDir);
    runGit(["config", "--local", "user.email", "test@phax.test"], repoDir);
    runGit(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    runGit(["add", "."], repoDir);
    runGit(["commit", "-m", "chore: initial commit"], repoDir);
    runGit(["remote", "add", "origin", remoteDir], repoDir);

    runPath = mkdtempSync(join(tmpdir(), "phax-compliance-hand-run-"));
    worktreePath = mkdtempSync(join(tmpdir(), "phax-compliance-hand-wt-"));
    await writeFile(join(runPath, "plan.md"), "# Plan\n");
    await writeFile(join(runPath, "global-file-reconciliation.md"), "# Reconciliation\n");
  });

  afterEach(() => {
    for (const dir of [repoDir, remoteDir, runPath, worktreePath]) removeTempDir(dir);
    restoreGit();
  });

  function info(): RunReviewInfo {
    return {
      namespace: NAMESPACE,
      shortName: SHORT_NAME,
      runId: "2610270900-by-hand",
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

  function review(
    summary: string,
    opts: {
      readonly refusedTwice?: boolean;
      readonly runInfo?: RunReviewInfo;
      readonly target?: ReviewRecordTarget | ReviewRecordUnresolved;
    } = {},
  ) {
    const runInfo = opts.runInfo ?? info();
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: "session-hand" as ClaudeSessionId,
      outputPath: "",
      finalText:
        opts.refusedTwice === true
          ? "Prose, not JSON."
          : JSON.stringify({ ...JSON.parse(COMPLIANCE_AGENT_JSON), summary }),
    });
    if (opts.refusedTwice === true) {
      backend.impl.addResumeResponse({
        sessionId: "session-hand" as ClaudeSessionId,
        outputPath: "",
        finalText: "More prose, still not JSON.",
      });
    }
    const layers = Layer.mergeAll(
      backend.layer,
      NodeFileSystemLayer,
      NodeGitLayer,
      NoopSystemTelemetryLayer,
      fakeGitHub.layer,
    );
    return Effect.runPromise(
      reviewComplianceAndRecord(
        runInfo,
        { enabled: true, model: "claude-sonnet-4-6", effort: "medium" },
        resolution,
        security,
        opts.target ?? {
          kind: "project",
          records: { ...RECORDS, autoPush: true },
          repoRoot: repoDir,
          push: { publishRemote: "origin" },
        },
        { output: { log() {}, warn() {}, error() {} } },
      ).pipe(Effect.provide(layers)),
    );
  }

  it("commits a new entry at the same key on each review, pushes it, and keeps the first file in history", async () => {
    const first = await review("first review");
    const second = await review("second review");

    for (const outcome of [first, second]) {
      expect(outcome.review.kind).toBe("generated");
      expect(outcome.record.kind).toBe("written");
      expect(outcome.push.kind).toBe("pushed");
    }

    const key = "2610270900-by-hand/compliance-review";
    const commits = runGit(["rev-list", "--reverse", RECORDS_BRANCH_NAME], repoDir)
      .trim()
      .split("\n");
    expect(commits).toHaveLength(2);
    const summaryAt = (repo: string, commit: string): string =>
      (
        JSON.parse(runGit(["show", `${commit}:${key}/compliance-review.json`], repo)) as {
          summary: string;
        }
      ).summary;
    expect(summaryAt(repoDir, commits[0] ?? "")).toBe("first review");
    expect(summaryAt(repoDir, commits[1] ?? "")).toBe("second review");

    // The remote's branch holds both.
    const remoteCommits = runGit(["rev-list", "--reverse", RECORDS_BRANCH_NAME], remoteDir)
      .trim()
      .split("\n");
    expect(remoteCommits).toEqual(commits);
    expect(summaryAt(remoteDir, remoteCommits[1] ?? "")).toBe("second review");
  });

  it("records an entry only after an accepted answer: a rerun refused twice records nothing and keeps the first review", async () => {
    const first = await review("first review");
    expect(first.record.kind).toBe("written");

    const second = await review("second review", { refusedTwice: true });
    expect(second.review.kind).toBe("failed");
    expect(second.record.kind).toBe("no-entry");
    expect(second.push.kind).toBe("no-record");

    const commits = runGit(["rev-list", RECORDS_BRANCH_NAME], repoDir).trim().split("\n");
    expect(commits).toHaveLength(1);
    const kept = JSON.parse(await readFile(join(runPath, "compliance-review.json"), "utf8")) as {
      summary: string;
    };
    expect(kept.summary).toBe("first review");
  });

  describe("a run of another project", () => {
    let restoreHome: () => void;
    let projectA: string;

    beforeEach(() => {
      const home = mkdtempSync(join(tmpdir(), "phax-compliance-hand-home-"));
      const originalHome = process.env["HOME"];
      process.env["HOME"] = home;
      restoreHome = () => {
        if (originalHome === undefined) delete process.env["HOME"];
        else process.env["HOME"] = originalHome;
        removeTempDir(home);
      };
      projectA = mkdtempSync(join(tmpdir(), "phax-compliance-hand-a-"));
      runGit(["init"], projectA);
      disableGitAutoMaintenance(projectA);
      runGit(["config", "--local", "user.email", "test@phax.test"], projectA);
      runGit(["config", "--local", "user.name", "phax test"], projectA);
      writeFileSync(join(projectA, "phax.json"), phaxJson("project-a"));
      runGit(["add", "."], projectA);
      runGit(["commit", "-m", "chore: initial commit"], projectA);
    });

    afterEach(() => {
      removeTempDir(projectA);
      restoreHome();
    });

    function configOfA(): ResolvedConfig {
      const loaded = loadConfig(projectA);
      if (Either.isLeft(loaded)) throw new Error(loaded.left.message);
      return loaded.right;
    }

    it("records the review in the run's own project, never the one the command runs from", async () => {
      // The run belongs to the project in repoDir (namespace test-project); its
      // final worktree is a linked worktree of that repository.
      writeFileSync(join(repoDir, "phax.json"), phaxJson(NAMESPACE));
      runGit(["add", "phax.json"], repoDir);
      runGit(["commit", "-m", "chore: phax.json"], repoDir);
      const linked = join(worktreePath, "final");
      runGit(["worktree", "add", "-b", "feature/by-hand--phase-01", linked], repoDir);
      const runInfo = { ...info(), worktreePath: linked };

      const target = reviewRecordTargetFor({
        config: configOfA(),
        namespace: NAMESPACE,
        info: runInfo,
        crossProject: true,
      });
      expect(target.kind).toBe("project");

      const outcome = await review("cross-project review", { runInfo, target });
      expect(outcome.record.kind).toBe("written");
      expect(outcome.push.kind).toBe("pushed");

      const key = "2610270900-by-hand/compliance-review";
      const entry = JSON.parse(
        runGit(["show", `${RECORDS_BRANCH_NAME}:${key}/compliance-review.json`], repoDir),
      ) as { summary: string };
      expect(entry.summary).toBe("cross-project review");
      expect(runGit(["rev-list", RECORDS_BRANCH_NAME], remoteDir).trim()).not.toBe("");
      expect(runGit(["branch", "--list", RECORDS_BRANCH_NAME], projectA).trim()).toBe("");
    });

    it("writes no entry anywhere when the run's project cannot be read, and says so", async () => {
      // worktreePath is a plain directory: no git working tree to find the
      // run's project from.
      const target = reviewRecordTargetFor({
        config: configOfA(),
        namespace: NAMESPACE,
        info: info(),
        crossProject: true,
      });
      expect(target.kind).toBe("unresolved");

      const outcome = await review("lost review", { target });
      expect(outcome.review.kind).toBe("generated");
      expect(outcome.record.kind).toBe("unresolved");
      expect(outcome.push.kind).toBe("no-record");
      const [warning] = reviewEntryWarnings(
        outcome,
        "compliance-review",
        "phax review-compliance test-project.x",
      );
      expect(warning).toContain(`its worktree ${worktreePath} is not a git working tree`);
      expect(warning).toContain("compliance-review.json stays in the run folder");
      expect(warning).toContain("`phax review-compliance test-project.x`");

      for (const repo of [repoDir, projectA]) {
        expect(runGit(["branch", "--list", RECORDS_BRANCH_NAME], repo).trim()).toBe("");
      }
    });
  });
});
