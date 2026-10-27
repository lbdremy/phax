import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { publishRun } from "../../src/app/publishRun.js";
import { generateReviewHandoff } from "../../src/app/reviewHandoff.js";
import { encodePhaseFileReconciliation } from "../../src/schemas/reconciliation.js";
import { phaseStatus } from "../helpers/phaseStatusFixture.js";
import { runStatus } from "../helpers/runStatusFixture.js";
import { reconciliationResult } from "../helpers/reconciliationFixture.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import { CODE_REVIEW_ESCAPES, CODE_REVIEW_LENSES } from "../../src/schemas/codeReview.js";
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
    withSchemaUrl(
      "run-status",
      runStatus({
        namespace: "test-project",
        shortName,
        runId: "test-run-999",
        state: "review_open",
        createdAt: now,
        updatedAt: now,
        phasesCount: 1,
        ...(planRepoRelPath !== undefined ? { planRepoRelPath } : {}),
      }),
    ),
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
  return phaseStatus({
    phaseId,
    phaseIndex,
    state: "committed",
    model: "claude-opus-5-5",
    effort: "medium",
    branchName: `feature/test-run--${phaseId}`,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
  });
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
        phaxVersion: "0.0.0-test",
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
        phaxVersion: "0.0.0-test",
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
        phaxVersion: "0.0.0-test",
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
        phaxVersion: "0.0.0-test",
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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

  const codeReviewFinding = {
    severity: "bug",
    file: "src/greet.ts",
    line: 7,
    message: "The greeting drops the name.",
    lens: CODE_REVIEW_LENSES[0],
    escape: CODE_REVIEW_ESCAPES[0],
    criterion: null,
    suggestion: "Keep the name.",
  };

  async function publishBody(codeReviewFile: unknown | undefined): Promise<string> {
    const { fs, git, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    if (codeReviewFile !== undefined) {
      fs.impl.setFile(`${runPath}/code-review.json`, JSON.stringify(codeReviewFile));
    }
    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
    );
    return fs.impl.getFile(`${runPath}/pr-body.md`)!;
  }

  it("lists the findings of code-review.json under Code review findings", async () => {
    const body = await publishBody({
      $schema: currentSchemaUrl("code-review"),
      findings: [codeReviewFinding],
    });
    expect(body).toContain(
      "### Code review findings\n\n- **bug** `src/greet.ts:7` — The greeting drops the name.",
    );
  });

  it("leaves the heading out when code-review.json is absent or refused", async () => {
    expect(await publishBody(undefined)).not.toContain("### Code review findings");
    // The answer's own `version` key is not a persisted file's key.
    const refused = await publishBody({ version: 1, findings: [codeReviewFinding] });
    expect(refused).not.toContain("### Code review findings");
  });

  it("says not reviewed when compliance-review.json is absent", async () => {
    const { fs, git, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
    );

    const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
    expect(body).toContain(`**Spec** ${outcome}`);
    expect(body).not.toContain("## Source spec");
  });

  it("has no spec line when source-spec-outcome.md is absent", async () => {
    const { fs, git, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });

    await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
        phaxVersion: "0.0.0-test",
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
        publishRun(makeInfo(), defaultConfig(), {
          repoRoot,
          now: constNow,
          phaxVersion: "0.0.0-test",
          ...opts,
        }).pipe(Effect.provide(layers)),
      );

      const body = fs.impl.getFile(`${runPath}/pr-body.md`)!;
      expect(body.includes("phax records explain")).toBe(expected);
    }
  });

  it("names the plan from run-status.json at its archive path, or a loose plan without one", async () => {
    for (const [planRepoRelPath, expected] of [
      [
        "docs/plans/2610101200-greet-cli-plan.md",
        "**Plan** `docs/plans/archive/2610101200-greet-cli-plan.md`",
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
        publishRun(makeInfo(), defaultConfig(), {
          repoRoot,
          now: constNow,
          phaxVersion: "0.0.0-test",
        }).pipe(Effect.provide(layers)),
      );

      expect(fs.impl.getFile(`${runPath}/pr-body.md`)).toContain(expected);
    }
  });

  it("fails publication without creating a PR when run-status.json is unreadable", async () => {
    const { fs, git, github, layers } = setupLayers();
    seedSuccessPreconditions({ fs, git });
    fs.impl.setFile(`${runPath}/run-status.json`, "{ not json");

    const result = await Effect.runPromise(
      publishRun(makeInfo(), defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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
      publishRun(info, defaultConfig(), {
        repoRoot,
        now: constNow,
        phaxVersion: "0.0.0-test",
      }).pipe(Effect.provide(layers)),
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

// The run folder's plan.md copy, declaring `sourceSpec` (`null` for none).
function planCopy(sourceSpec: string): string {
  const completes = sourceSpec === "null" ? "" : "completes-spec: true\n";
  return `---\nstatus: Approved\nsource-spec: ${sourceSpec}\n${completes}---\n# Greet CLI\n`;
}

describe("publishRun — the phax footer", () => {
  const LIVE_PLAN = "docs/plans/2610101200-greet-cli-plan.md";
  const ARCHIVED_PLAN = "docs/plans/archive/2610101200-greet-cli-plan.md";
  const LIVE_SPEC = "docs/specs/2610091100-greet-cli.md";
  const ARCHIVED_SPEC = "docs/specs/archive/2610091100-greet-cli.md";
  const WEB = "https://github.com/example/repo";

  // Seeds the final phase branch's head commit holding `paths`; returns its sha.
  function seedHead(git: ReturnType<typeof makeFakeGit>, paths: readonly string[]): string {
    return Effect.runSync(
      git.impl.writeTreeCommit({
        repo: repoRoot,
        branch: finalBranch,
        message: "phase-01",
        files: paths.map((path) => ({ path, content: new TextEncoder().encode(path) })),
      }),
    );
  }

  function binding(phaseId: string, provider: string, model: string, effort: string): string {
    return JSON.stringify({
      version: 1,
      shortName,
      runId: "test-run-999",
      phaseId,
      phaseIndex: Number(phaseId.slice(-2)) - 1,
      phaseName: phaseId,
      provider,
      adapter: provider === "codex-cli" ? "codex" : "claude",
      model,
      effort,
      sessionId: null,
      sessionHandle: null,
      worktreePath: `/fake/wt/${phaseId}`,
      cwd: `/fake/wt/${phaseId}`,
      launchedAt: now,
      status: "completed",
    });
  }

  async function publishBody(args: {
    planRepoRelPath?: string;
    planCopy?: string;
    head?: readonly string[];
    info?: RunReviewInfo;
    setup?: (s: ReturnType<typeof setupLayers>) => void;
    phaxVersion?: string;
    config?: Partial<ResolvedPublishConfig>;
  }) {
    const s = setupLayers();
    seedSuccessPreconditions({
      fs: s.fs,
      git: s.git,
      ...(args.planRepoRelPath !== undefined ? { planRepoRelPath: args.planRepoRelPath } : {}),
    });
    if (args.planCopy !== undefined) s.fs.impl.setFile(`${runPath}/plan.md`, args.planCopy);
    const sha = args.head !== undefined ? seedHead(s.git, args.head) : null;
    args.setup?.(s);
    const result = await Effect.runPromise(
      publishRun(args.info ?? makeInfo(), defaultConfig(args.config), {
        repoRoot,
        now: constNow,
        phaxVersion: args.phaxVersion ?? "0.0.0-test",
      }).pipe(Effect.provide(s.layers)),
    );
    return { ...s, result, sha, body: s.fs.impl.getFile(`${runPath}/pr-body.md`) ?? "" };
  }

  it("(a) links an archived plan and spec at the head sha and names the archived plan", async () => {
    const { body, sha, git } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      planCopy: planCopy(LIVE_SPEC),
      head: [ARCHIVED_PLAN, ARCHIVED_SPEC, "src/greet.ts"],
    });
    const planLink = `[\`${ARCHIVED_PLAN}\`](${WEB}/blob/${sha}/${ARCHIVED_PLAN})`;
    const specLink = `[\`${ARCHIVED_SPEC}\`](${WEB}/blob/${sha}/${ARCHIVED_SPEC})`;
    expect(body).toContain(`\n**Plan** ${planLink} · **Spec** ${specLink}\\\n`);
    expect(body.split("\n")[0]).toContain(`**Plan** ${planLink} · **Gate profile**`);
    expect(body).not.toContain(`\`${LIVE_PLAN}\``);
    expect(git.impl.calls).toContainEqual({
      method: "resolveRef",
      repo: repoRoot,
      ref: `refs/heads/${finalBranch}`,
    });
  });

  it("(b) links a spec kept live at its docs/specs/ path", async () => {
    const { body, sha } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      planCopy: planCopy(LIVE_SPEC),
      head: [ARCHIVED_PLAN, LIVE_SPEC],
    });
    expect(body).toContain(`**Spec** [\`${LIVE_SPEC}\`](${WEB}/blob/${sha}/${LIVE_SPEC})`);
  });

  it("(c) writes code spans when the web URL lookup fails, and still publishes", async () => {
    const { body, result } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      planCopy: planCopy(LIVE_SPEC),
      head: [ARCHIVED_PLAN, ARCHIVED_SPEC],
      setup: ({ github }) => github.impl.failNextRepoWebUrl("no git remotes found"),
    });
    expect(result.kind).toBe("published");
    expect(body).toContain(`\n**Plan** \`${ARCHIVED_PLAN}\` · **Spec** \`${ARCHIVED_SPEC}\`\\\n`);
    expect(body).not.toContain("/blob/");
  });

  it("(d) names the plan at its archive counterpart and no spec when the head is unresolved", async () => {
    const { body, result } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      planCopy: planCopy(LIVE_SPEC),
    });
    expect(result.kind).toBe("published");
    expect(body).toContain(`\n**Plan** \`${ARCHIVED_PLAN}\`\\\n`);
    expect(body).not.toContain("**Spec**");
    expect(body).not.toContain("/blob/");
  });

  it("(e) writes a loose plan as a code span", async () => {
    const { body } = await publishBody({
      planRepoRelPath: "notes/greet-plan.md",
      head: ["notes/greet-plan.md"],
    });
    expect(body).toContain("\n**Plan** `notes/greet-plan.md`\\\n");
  });

  it("(f) has no Spec part for a plan declaring source-spec: null", async () => {
    const { body } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      planCopy: planCopy("null"),
      head: [ARCHIVED_PLAN],
    });
    expect(body).toContain(`\n**Plan** [\`${ARCHIVED_PLAN}\`](`);
    expect(body).not.toContain("**Spec**");
  });

  it("(g) groups three agent bindings with two assignments on one Agents line", async () => {
    const phaseIds = ["phase-01", "phase-02", "phase-03"];
    const info = makeInfo({
      phaseStatuses: phaseIds.map((id, i) => makePhaseStatus(id, i)),
      planPhases: phaseIds.map((id) => ({ id, title: `Made-up ${id}` })),
      finalPhaseId: "phase-03",
    });
    const { body } = await publishBody({
      info,
      setup: ({ fs }) => {
        for (const id of phaseIds) {
          fs.impl.setFile(
            `${runPath}/${id}/file-reconciliation.json`,
            JSON.stringify(
              encodePhaseFileReconciliation({ phaseId: id, ...reconciliationResult({}) }),
            ),
          );
          fs.impl.setFile(`${runPath}/${id}/file-reconciliation.md`, "Reconciliation.");
          fs.impl.setFile(`${runPath}/${id}/phase-handoff.md`, "Handoff.");
        }
        fs.impl.setFile(
          `${runPath}/phase-01/agent-binding.json`,
          binding("phase-01", "claude-code", "claude-made-up-1", "medium"),
        );
        fs.impl.setFile(
          `${runPath}/phase-02/agent-binding.json`,
          binding("phase-02", "codex-cli", "gpt-made-up", "high"),
        );
        fs.impl.setFile(
          `${runPath}/phase-03/agent-binding.json`,
          binding("phase-03", "claude-code", "claude-made-up-1", "medium"),
        );
      },
    });
    expect(body).toContain(
      "\n**Agents** claude-code `claude-made-up-1` at medium: 2 phases; codex-cli `gpt-made-up` at high: 1 phase\\\n",
    );
    expect(body.endsWith("**Run** `test-project.test-run`")).toBe(true);
  });

  it("(h) looks nothing up and writes no body for a pull request that already exists", async () => {
    const { github, git, fs } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      head: [ARCHIVED_PLAN],
      setup: ({ github: gh }) =>
        gh.impl.seedExistingPr(finalBranch as string, "https://github.com/owner/repo/pull/7"),
    });
    expect(github.impl.calls.some((c) => c.method === "repoWebUrl")).toBe(false);
    expect(git.impl.calls.some((c) => c.method === "readTree")).toBe(false);
    expect(fs.impl.getFile(`${runPath}/pr-body.md`)).toBeUndefined();
  });

  it("(j) writes code spans and looks up no web URL when the branch is not pushed", async () => {
    const { body, result, git, github } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      planCopy: planCopy(LIVE_SPEC),
      head: [ARCHIVED_PLAN, ARCHIVED_SPEC],
      config: { pushBranch: false },
    });
    expect(result.kind).toBe("published");
    expect(git.impl.calls.some((c) => c.method === "pushBranch")).toBe(false);
    expect(github.impl.calls.some((c) => c.method === "repoWebUrl")).toBe(false);
    expect(body).toContain(`\n**Plan** \`${ARCHIVED_PLAN}\` · **Spec** \`${ARCHIVED_SPEC}\`\\\n`);
    expect(body).not.toContain("/blob/");
  });

  it("(i) names the version from the option in the generated line", async () => {
    const { body } = await publishBody({
      planRepoRelPath: LIVE_PLAN,
      phaxVersion: "9.8.7-made-up",
    });
    expect(body).toContain(
      "\n🛤️ Generated with [phax](https://docs.phax.run) 9.8.7-made-up — the golden path, just facts\\\n",
    );
  });
});
