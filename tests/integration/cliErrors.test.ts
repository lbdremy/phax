import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  type BoundedExit,
  CLI_BOUND_MS,
  CLI_LAUNCHER,
  GIT_BOUND_MS,
  boundedOutput,
  boundedSpawn,
  cliArgs,
} from "../helpers/boundedSpawn.js";

// A command the phase guard refuses must run from a temporary cwd: this
// repository's own phases run the tests from inside a phase worktree.
function runCli(args: string[], cwd?: string): BoundedExit {
  return boundedSpawn(CLI_LAUNCHER, cliArgs(...args), {
    boundMs: CLI_BOUND_MS,
    env: phaxHomeEnv(),
    ...(cwd !== undefined ? { cwd } : {}),
  });
}

describe("CLI error messages", { timeout: 30_000 }, () => {
  it("unknown command: exit 64, suggestion, help pointer, no stack trace", () => {
    const result = runCli(["resum"]);
    expect(result.status).toBe(64);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toMatch(/unknown command/i);
    expect(combined).toMatch(/Did you mean/i);
    expect(combined).toContain("resume");
    expect(combined).toMatch(/--help/);
    expect(combined).not.toMatch(/Error:\s+Error:/);
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
  });

  it("unknown flag on a subcommand: exit 64, readable message, no stack trace", () => {
    // A located command is guarded, and the runner checks the guard before it parses: inside
    // one of a run's phase worktrees the guard reads the run's phax home.
    const result = runCli(["ls", "--notaflag"], realpathSync(tmpdir()));
    expect(result.status).toBe(64);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toMatch(/unknown option/i);
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
  });

  it("a missing argument: exit 64 with Commander's text", () => {
    // `unlock` is guarded in a phase worktree, and the runner checks the guard before it parses.
    const result = runCli(["unlock"], realpathSync(tmpdir()));
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("error: missing required argument 'short-name'");
  });

  it("invalid choice for completions <shell>: lists valid choices, no stack trace", () => {
    const result = runCli(["completions", "ksh"]);
    expect(result.status).not.toBe(0);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toContain("ksh");
    expect(combined).toContain("zsh");
    expect(combined).toContain("bash");
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
  });

  it("valid command still exits 0", () => {
    const result = runCli(["--version"]);
    expect(result.status).toBe(0);
  });

  describe("phax run against a non-Approved plan", () => {
    let tmpDir: string;

    afterEach(() => {
      removeTempDir(tmpDir);
    });

    it("Draft plan: non-zero exit, message names the file and status, no stack trace", () => {
      // The CLI runs from a made-up repository; the plan lives outside it.
      // Canonical, so the plan prints as ../plan.md on macOS too, where /var is a symlink.
      tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-cli-errors-")));
      const repo = join(tmpDir, "repo");
      mkdirSync(repo);
      boundedOutput("git", ["init", "-q"], { boundMs: GIT_BOUND_MS, cwd: repo });
      disableGitAutoMaintenance(repo);
      writeFileSync(
        join(repo, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "test",
          state: { root: join(repo, ".phax-state") },
          gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
        }),
      );
      const planPath = join(tmpDir, "plan.md");
      writeFileSync(
        planPath,
        "---\nstatus: Draft\nsource-spec: null\n---\n# Draft plan\n\n## Context\n",
      );

      const result = runCli(["run", "--plan", planPath], repo);
      expect(result.status).not.toBe(0);
      const combined = (result.stderr ?? "") + (result.stdout ?? "");
      expect(combined).toContain("../plan.md is still in Draft status");
      expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
    });
  });

  describe("phax run against a stale Approved plan", () => {
    let tmpRepoRoot: string;

    afterEach(() => {
      removeTempDir(tmpRepoRoot);
    });

    it("Approved docs/plans/ plan with no approval record: exit 12, message names the missing record and the approve remedy, no stack trace", () => {
      // Canonicalize: `git rev-parse --show-toplevel` (used by loadConfig)
      // resolves symlinks, so tmpRepoRoot must match or the plan path's
      // repo-relative classification silently fails on macOS's /tmp symlink.
      tmpRepoRoot = realpathSync(mkdtempSync(join(tmpdir(), "phax-cli-errors-stale-")));
      boundedOutput("git", ["init", "-q"], { boundMs: GIT_BOUND_MS, cwd: tmpRepoRoot });
      disableGitAutoMaintenance(tmpRepoRoot);
      boundedOutput("git", ["config", "user.email", "test@example.com"], {
        boundMs: GIT_BOUND_MS,
        cwd: tmpRepoRoot,
      });
      boundedOutput("git", ["config", "user.name", "Test"], {
        boundMs: GIT_BOUND_MS,
        cwd: tmpRepoRoot,
      });

      writeFileSync(
        join(tmpRepoRoot, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "test",
          state: { root: join(tmpRepoRoot, ".phax-state") },
          gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
        }),
      );

      mkdirSync(join(tmpRepoRoot, "docs", "plans"), { recursive: true });
      const planRelPath = "docs/plans/stale-gate-test.md";
      const planPath = join(tmpRepoRoot, planRelPath);
      writeFileSync(
        planPath,
        [
          "---",
          "status: Approved",
          "source-spec: null",
          "---",
          "# Stale gate test plan",
          "",
          "---",
          "",
          "## Gate profile",
          "",
          "`fast`",
          "",
          "## Required commands",
          "",
          "- (none)",
          "",
          "---",
          "",
          "## phase-01 — Do the thing {#phase-01-do-thing}",
          "",
          "**Recommended model:** claude-sonnet-4-6",
          "**Recommended effort:** low",
          "",
          "Do the thing.",
          "",
          "### Detailed instructions",
          "",
          "- Do the thing.",
          "",
          "### Planned files to create",
          "",
          "- (none)",
          "",
          "### Planned files to edit",
          "",
          "- (none)",
          "",
          "### Optional files that may be edited",
          "",
          "- (none)",
          "",
          "### Excluded scope",
          "",
          "- (none)",
          "",
          "### Verification",
          "",
          "- The project's configured `full` gate profile in `phax.json`.",
          "",
          "### Expected handoff content",
          "",
          "- N/A",
          "",
          "### Commit subject",
          "",
          "chore: do the thing",
          "",
          "### Commit body",
          "",
          "Do the thing.",
          "",
        ].join("\n"),
      );
      boundedOutput("git", ["add", "-A"], { boundMs: GIT_BOUND_MS, cwd: tmpRepoRoot });
      boundedOutput("git", ["commit", "-q", "-m", "seed"], {
        boundMs: GIT_BOUND_MS,
        cwd: tmpRepoRoot,
      });

      const result = boundedSpawn(CLI_LAUNCHER, cliArgs("run", "--plan", planPath), {
        boundMs: CLI_BOUND_MS,
        cwd: tmpRepoRoot,
        env: phaxHomeEnv(),
      });

      expect(result.status).toBe(12);
      const combined = (result.stderr ?? "") + (result.stdout ?? "");
      expect(combined).toContain(planRelPath);
      expect(combined).toMatch(/no approval record/i);
      expect(combined).toContain(`phax artifact approve ${planRelPath}`);
      expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
    });
  });
});
