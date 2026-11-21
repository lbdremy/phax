import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { loadConfig } from "../../../src/app/loadConfig.js";
import { reviewRecordTargetFor } from "../../../src/app/reviewEntry.js";
import { reviewCodeAndRecord } from "../../../src/app/reviewCode.js";
import { resolveRun } from "../../../src/app/resolveRunInfo.js";
import type { ClaudeSessionId, ShortName } from "../../../src/domain/branded.js";
import type { RoutingResolution } from "../../../src/domain/routing/types.js";
import { makeFakeBackend } from "../../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../../src/infra/fs.js";
import { NodeGitLayer } from "../../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../../src/ports/systemTelemetry.js";
import { codeReviewFileText, type PersistedCodeReview } from "../../../src/schemas/codeReview.js";
import {
  complianceReviewFileText,
  type PersistedComplianceReview,
} from "../../../src/schemas/complianceReview.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import type { ResolvedSecurityConfig } from "../../../src/schemas/securityConfig.js";
import { isolateGit } from "../../helpers/isolateGit.js";
import { isolatePhaxHome } from "../../helpers/isolatePhaxHome.js";
import { phaxPlanJson } from "../../helpers/costHistory.js";
import { phaseStatusFile } from "../../helpers/phaseStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { boundedOutput, GIT_BOUND_MS } from "../../helpers/boundedSpawn.js";

// A project for the acceptance tests of `phax finding list`: a git repository in a temporary
// directory with its own identity, a phax.json with records in-repo (no push) and the code
// review enabled, a temporary PHAX home, and one run in `review_open` under a state root inside
// the repository: its run-status.json, phase-01 status, plan and git worktree. Nothing outside
// its temporary directories is read. A test file that builds it hoists the `node:os` mock of
// tests/helpers/isolatePhaxHome.ts, and sets the process working directory to `repoDir`.

const NAMESPACE = "findings-test";
const NOW = "2026-11-01T10:00:00.000Z";
const FIXTURE_SHORT_NAME = "listed-run";
const FIXTURE_RUN_ID = "listed-run-1700000000000";

export interface FindingRunRepo {
  readonly shortName: string;
  readonly runId: string;
  /** The run's folder under the state root: where the reviews' files are written. */
  readonly runFolder: string;
  readonly repoDir: string;
  readonly stateRoot: string;
  readonly cleanup: () => void;
}

function git(args: readonly string[], cwd: string): void {
  boundedOutput("git", [...args], { boundMs: GIT_BOUND_MS, cwd });
}

/** Builds the project and the run in temporary directories; call `cleanup` after the test. */
export function buildFindingRunRepo(): FindingRunRepo {
  const home = isolatePhaxHome();
  const restoreGit = isolateGit();
  const base = realpathSync(mkdtempSync(join(tmpdir(), "phax-finding-list-")));
  const repoDir = join(base, "repo");
  const stateRoot = join(repoDir, ".phax-state");
  mkdirSync(repoDir);
  git(["init", "-q", "-b", "main"], repoDir);
  disableGitAutoMaintenance(repoDir);
  git(["config", "--local", "user.email", "test@phax.test"], repoDir);
  git(["config", "--local", "user.name", "phax test"], repoDir);
  writeFileSync(
    join(repoDir, "phax.json"),
    JSON.stringify(
      {
        version: 1,
        name: NAMESPACE,
        state: { root: stateRoot },
        review: { code: { enabled: true } },
        records: { transcript: false, destination: { kind: "in-repo" }, autoPush: false },
        gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(repoDir, "README.md"), "# findings\n");
  git(["add", "README.md"], repoDir);
  git(["commit", "-q", "-m", "chore: initial commit"], repoDir);

  const runFolder = join(stateRoot, "runs", `${NAMESPACE}.${FIXTURE_SHORT_NAME}`);
  const worktreePath = join(stateRoot, "worktrees", FIXTURE_SHORT_NAME, "phase-01");
  const branchName = `feature/${FIXTURE_SHORT_NAME}--phase-01`;
  mkdirSync(join(runFolder, "phase-01"), { recursive: true });
  mkdirSync(join(stateRoot, "worktrees", FIXTURE_SHORT_NAME), { recursive: true });
  git(["worktree", "add", "-q", "-b", branchName, worktreePath], repoDir);
  writeFileSync(
    join(runFolder, "run-status.json"),
    JSON.stringify({
      version: 1,
      namespace: NAMESPACE,
      shortName: FIXTURE_SHORT_NAME,
      runId: FIXTURE_RUN_ID,
      state: "review_open",
      createdAt: NOW,
      updatedAt: NOW,
      phasesCount: 1,
      gateProfileId: "fast",
    }),
  );
  writeFileSync(
    join(runFolder, "phase-01", "status.json"),
    JSON.stringify(
      phaseStatusFile({
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "committed",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName,
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        createdAt: NOW,
        updatedAt: NOW,
        worktreePath,
        claudeSessionId: "sess-abc",
      }),
    ),
  );
  writeFileSync(join(runFolder, "plan.md"), "# Plan\n");
  writeFileSync(join(runFolder, "phax-plan.json"), phaxPlanJson([{ id: "phase-01" }]));

  return {
    shortName: FIXTURE_SHORT_NAME,
    runId: FIXTURE_RUN_ID,
    runFolder,
    repoDir,
    stateRoot,
    cleanup: () => {
      removeTempDir(base);
      restoreGit();
      home.restore();
    },
  };
}

const olderCodeFinding = (n: number) => ({
  severity: "concern",
  file: "src/older.ts",
  line: n,
  message: `older code finding ${n}`,
  lens: "core",
  escape: "omission",
  criterion: null,
  suggestion: "Cover it with a test.",
});

const olderComplianceFinding = (n: number) => ({
  dimension: "files",
  severity: "deviation",
  message: `older compliance finding ${n}`,
});

/**
 * Writes, in the frozen 0.32.0 shapes (no ids), a `code-review.json` of three findings and a
 * `compliance-review.json` of one finding in phase-01 and two in phase-02. Returns each file's
 * text, so a test can check the call left them as they were.
 */
export function writeOlderReviews(repo: FindingRunRepo): {
  readonly codeReview: string;
  readonly complianceReview: string;
} {
  const codeReview = JSON.stringify(
    {
      $schema: schemaUrl("code-review", "0.32.0"),
      findings: [1, 2, 3].map(olderCodeFinding),
    },
    null,
    2,
  );
  const complianceReview = JSON.stringify(
    {
      $schema: schemaUrl("compliance-review", "0.32.0"),
      verdict: "conformant-with-deviations",
      summary: "Older review.",
      perPhase: [
        { phaseId: "phase-01", verdict: "conformant", findings: [1].map(olderComplianceFinding) },
        {
          phaseId: "phase-02",
          verdict: "conformant-with-deviations",
          findings: [2, 3].map(olderComplianceFinding),
        },
      ],
      unplannedChanges: [],
      unmetPromises: [],
      attentionPoints: [],
      pointers: [],
    },
    null,
    2,
  );
  writeFileSync(join(repo.runFolder, "code-review.json"), codeReview);
  writeFileSync(join(repo.runFolder, "compliance-review.json"), complianceReview);
  return { codeReview, complianceReview };
}

/** What `writeCurrentReviews` stores: a code review F1 and F2, and a compliance review C1. */
export const CURRENT_CODE_REVIEW: PersistedCodeReview = {
  findings: [
    {
      id: "F1",
      severity: "bug",
      file: "src/a.ts",
      line: 12,
      message: "The flag is ignored.",
      lens: "surface",
      escape: "wrong-oracle",
      criterion: "ac-1",
      suggestion: "Read the flag.",
    },
    {
      id: "F2",
      severity: "concern",
      file: "src/b.ts",
      line: 40,
      message: "The error is swallowed.",
      lens: "core",
      escape: "omission",
      criterion: null,
      suggestion: "Surface the error.",
    },
  ],
};

export const CURRENT_COMPLIANCE_REVIEW: PersistedComplianceReview = {
  verdict: "conformant-with-deviations",
  summary: "One deviation.",
  perPhase: [
    {
      phaseId: "phase-01",
      verdict: "conformant-with-deviations",
      findings: [{ id: "C1", dimension: "tests", severity: "deviation", message: "No test." }],
    },
  ],
  unplannedChanges: [],
  unmetPromises: [],
  attentionPoints: [],
  pointers: [],
};

/** Writes, through the file writers, a code review F1 and F2 and a compliance review C1. */
export function writeCurrentReviews(repo: FindingRunRepo): void {
  writeFileSync(join(repo.runFolder, "code-review.json"), codeReviewFileText(CURRENT_CODE_REVIEW));
  writeFileSync(
    join(repo.runFolder, "compliance-review.json"),
    complianceReviewFileText(CURRENT_COMPLIANCE_REVIEW),
  );
}

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

/**
 * Runs the headless code review of the run over the fake backend, which answers a
 * `code-review-answer` with one finding per message; the review is persisted with its ids to the
 * run folder and the records branch. Real git; no provider. `record` is what the records entry
 * is expected to become: `written`, or `write-failed` when the test made the records commit fail.
 */
export async function reviewOnce(
  repo: FindingRunRepo,
  messages: readonly string[],
  record: "written" | "write-failed" = "written",
): Promise<void> {
  const config = loadConfig(repo.repoDir);
  if (Result.isFailure(config)) throw new Error(config.failure.message);
  const resolved = resolveRun(
    config.success.namespace,
    repo.shortName as ShortName,
    repo.stateRoot,
  );
  if (Result.isFailure(resolved)) throw new Error(resolved.failure);
  const info = resolved.success;
  const backend = makeFakeBackend();
  backend.impl.addRunResponse({
    sessionId: `session-${messages.join("-")}` as ClaudeSessionId,
    outputPath: "",
    finalText: JSON.stringify({
      $schema: schemaUrl("code-review-answer", CURRENT_STAMPS["code-review-answer"]),
      findings: messages.map((message) => ({
        severity: "concern",
        file: "src/reviewed.ts",
        line: 7,
        message,
        lens: "core",
        escape: "omission",
        criterion: null,
        suggestion: "Cover it with a test.",
      })),
    }),
  });
  const github = makeFakeGitHub();
  github.impl.setVisibility("private");
  const layers = Layer.mergeAll(
    backend.layer,
    NodeFileSystemLayer,
    NodeGitLayer,
    NoopSystemTelemetryLayer,
    github.layer,
  );
  const outcome = await Effect.runPromise(
    reviewCodeAndRecord(
      info,
      config.success.codeReview,
      resolution,
      security,
      reviewRecordTargetFor({
        config: config.success,
        namespace: config.success.namespace,
        info,
        crossProject: false,
      }),
      {
        bundledReviewSkill: "# phax review\n",
        nowIso: "2026-11-01T11:00:00.000Z",
        output: { log() {}, warn() {}, error() {} },
      },
    ).pipe(Effect.provide(layers)),
  );
  if (outcome.review.kind !== "accepted" || outcome.record.kind !== record) {
    throw new Error(`the review was not ${record}: ${outcome.review.kind}/${outcome.record.kind}`);
  }
}
