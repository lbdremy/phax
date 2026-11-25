// SEC-09: the code review reads the project review skill from the run base's tree, never from
// the run's worktree. Real git in a temporary repository; the fake backend captures the
// reviewer's prompt.
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reviewCodeHeadless } from "../../src/app/reviewCode.js";
import { decodeBranchName, decodeClaudeSessionId } from "../../src/domain/branded.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import { GIT_BOUND_MS, boundedOutput } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaseStatus } from "../helpers/phaseStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const SKILL_DIR = ".claude/skills/phax-review";
const SKILL = `${SKILL_DIR}/SKILL.md`;
const BUNDLED = "---\nname: phax-review\n---\n\n# Bundled doctrine\n";
const skillText = (marker: string) => `---\nname: phax-review\n---\n\n# Doctrine ${marker}\n`;
const nowIso = "2026-10-27T12:00:00.000Z";

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

const answer = JSON.stringify({
  $schema: schemaUrl("code-review-answer", CURRENT_STAMPS["code-review-answer"]),
  findings: [],
});

function git(cwd: string, ...args: string[]): string {
  return boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd });
}

describe("code review skill from the run base (real git)", () => {
  let restoreGit: () => void;
  let repo: string;
  let runPath: string;

  beforeEach(() => {
    restoreGit = isolateGit();
    repo = mkdtempSync(join(tmpdir(), "phax-review-skill-repo-"));
    runPath = mkdtempSync(join(tmpdir(), "phax-review-skill-run-"));
    git(repo, "init", "-b", "main");
    disableGitAutoMaintenance(repo);
    git(repo, "config", "--local", "user.email", "test@phax.test");
    git(repo, "config", "--local", "user.name", "phax test");
    git(repo, "config", "--local", "commit.gpgsign", "false");
  });

  afterEach(() => {
    removeTempDir(repo);
    removeTempDir(runPath);
    restoreGit();
  });

  function commit(message: string): string {
    git(repo, "add", "-A");
    git(repo, "commit", "--allow-empty", "-m", message);
    return git(repo, "rev-parse", "HEAD").trim();
  }

  function writeSkill(text: string): void {
    mkdirSync(join(repo, SKILL_DIR), { recursive: true });
    writeFileSync(join(repo, SKILL), text);
  }

  function linkSkill(): void {
    mkdirSync(join(repo, SKILL_DIR), { recursive: true });
    writeFileSync(join(repo, "elsewhere.md"), "# Elsewhere\n");
    symlinkSync("../../../elsewhere.md", join(repo, SKILL));
  }

  /**
   * Review the run whose base is `base`. As in a real run, the run branch stays at the base
   * and the phases' commits sit on the final phase's branch (here `main`, the repo's HEAD).
   */
  async function review(base: string) {
    // The all-zero base of the unreadable case names no commit: there is nothing to branch from.
    if (!/^0+$/.test(base)) {
      git(repo, "branch", "-f", "phax/my-run", base);
    }
    const backend = makeFakeBackend();
    backend.impl.addRunResponse({
      sessionId: Result.getOrThrow(decodeClaudeSessionId("session-a")),
      outputPath: join(runPath, "code-review.session.jsonl"),
      finalText: answer,
    });
    const info: RunReviewInfo = {
      namespace: "test-project",
      shortName: "my-run",
      runId: "my-run-001",
      runState: "review_open",
      branch: "phax/my-run",
      runTitle: "My Run",
      finalPhaseBranch: Result.getOrThrow(decodeBranchName("main")),
      stateRoot: runPath,
      runPath,
      finalPhaseId: "phase-01",
      finalPhaseTitle: "Phase 01",
      worktreePath: repo,
      claudeSessionId: undefined,
      gateProfileId: "full",
      phaseStatuses: [
        phaseStatus({
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "review_open",
          model: "example-model",
          effort: "medium",
          createdAt: nowIso,
          updatedAt: nowIso,
          branchName: "main",
          base,
          worktreePath: repo,
        }),
      ],
      planPhases: [{ id: "phase-01", title: "Phase 01" }],
      updatedAt: nowIso,
      stoppedReason: undefined,
      lastError: undefined,
    };
    const layer = Layer.mergeAll(
      NodeFileSystemLayer,
      NodeGitLayer,
      backend.layer,
      makeFakeGitHub().layer,
      NoopSystemTelemetryLayer,
    );
    const result = await Effect.runPromise(
      reviewCodeHeadless(
        info,
        { enabled: false, model: "claude-opus-5-5", effort: "high" },
        resolution,
        security,
        {
          bundledReviewSkill: BUNDLED,
          nowIso,
          output: { log() {}, warn() {}, error() {} },
          findingsAfter: 0,
        },
      ).pipe(Effect.provide(layer)),
    );
    return { result, prompt: backend.impl.runCalls[0]?.prompt ?? "" };
  }

  it("a skill the run rewrote is not read: the prompt carries the base copy", async () => {
    writeSkill(skillText("A"));
    const base = commit("base");
    writeSkill(skillText("B"));
    commit("phase rewrites the skill");

    const { result, prompt } = await review(base);

    expect(prompt).toContain("Doctrine A");
    expect(prompt).not.toContain("Doctrine B");
    expect(prompt).toContain("(project)");
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.skill).toEqual({
        source: "project",
        baseShort: base.slice(0, 7),
        changedByRun: true,
        baseReadable: true,
      });
    }
  });

  it("a skill the run added is not read: the bundled skill is followed", async () => {
    writeFileSync(join(repo, "README.md"), "# repo\n");
    const base = commit("base");
    writeSkill(skillText("B"));
    commit("phase adds a skill");

    const { result, prompt } = await review(base);

    expect(prompt).toContain("Bundled doctrine");
    expect(prompt).not.toContain("Doctrine B");
    expect(prompt).toContain("(bundled)");
    if (result.kind === "accepted") {
      expect(result.skill).toEqual({
        source: "bundled",
        baseShort: base.slice(0, 7),
        changedByRun: true,
        baseReadable: true,
      });
    } else {
      expect(result.kind).toBe("accepted");
    }
  });

  it("a symbolic link the run added is not read: the bundled skill is followed", async () => {
    writeFileSync(join(repo, "README.md"), "# repo\n");
    const base = commit("base");
    linkSkill();
    commit("phase adds a link");

    const { result, prompt } = await review(base);

    expect(prompt).toContain("Bundled doctrine");
    expect(prompt).not.toContain("# Elsewhere");
    if (result.kind === "accepted") {
      expect(result.skill.source).toBe("bundled");
      expect(result.skill.changedByRun).toBe(true);
    } else {
      expect(result.kind).toBe("accepted");
    }
  });

  it("an untouched project skill is followed, with no change reported", async () => {
    writeSkill(skillText("A"));
    const base = commit("base");
    writeFileSync(join(repo, "other.txt"), "other\n");
    commit("phase touches something else");

    const { result, prompt } = await review(base);

    expect(prompt).toContain("Doctrine A");
    expect(prompt).toContain("(project)");
    if (result.kind === "accepted") {
      expect(result.skill).toEqual({
        source: "project",
        baseShort: base.slice(0, 7),
        changedByRun: false,
        baseReadable: true,
      });
    } else {
      expect(result.kind).toBe("accepted");
    }
  });

  it("a symlink blob at the skill path in the base counts as absent", async () => {
    linkSkill();
    const base = commit("base with a link");
    writeFileSync(join(repo, "other.txt"), "other\n");
    commit("phase touches something else");

    const { result, prompt } = await review(base);

    expect(prompt).toContain("Bundled doctrine");
    expect(prompt).not.toContain("# Elsewhere");
    if (result.kind === "accepted") {
      expect(result.skill.source).toBe("bundled");
      expect(result.skill.changedByRun).toBe(false);
    } else {
      expect(result.kind).toBe("accepted");
    }
  });

  it("a base the review cannot read is reported, not taken for a project without a skill", async () => {
    writeSkill(skillText("A"));
    commit("base");

    const { result, prompt } = await review("0".repeat(40));

    expect(prompt).toContain("Bundled doctrine");
    if (result.kind === "accepted") {
      expect(result.skill).toEqual({
        source: "bundled",
        baseShort: "0000000",
        changedByRun: false,
        baseReadable: false,
      });
    } else {
      expect(result.kind).toBe("accepted");
    }
  });
});
