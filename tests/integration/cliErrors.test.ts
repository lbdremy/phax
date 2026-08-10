import { describe, expect, it, afterEach } from "vitest";
import { execSync, spawnSync, spawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const mainTs = join(repoRoot, "src/cli/main.ts");

function runCli(args: string[]): spawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    encoding: "utf8",
  });
}

describe("CLI error messages", () => {
  it("unknown command: non-zero exit, suggestion, help pointer, no stack trace", () => {
    const result = runCli(["resum"]);
    expect(result.status).not.toBe(0);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toMatch(/unknown command/i);
    expect(combined).toMatch(/Did you mean/i);
    expect(combined).toContain("resume");
    expect(combined).toMatch(/--help/);
    expect(combined).not.toMatch(/Error:\s+Error:/);
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
  });

  it("unknown flag on a subcommand: non-zero exit, readable message, no stack trace", () => {
    const result = runCli(["ls", "--notaflag"]);
    expect(result.status).not.toBe(0);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toMatch(/unknown option/i);
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
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
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it("Draft plan: non-zero exit, message names the file and status, no stack trace", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "phax-cli-errors-"));
      const planPath = join(tmpDir, "plan.md");
      writeFileSync(planPath, "# Draft plan\n\nStatus: Draft\n\n## Context\n");

      const result = runCli(["run", "--plan", planPath]);
      expect(result.status).not.toBe(0);
      const combined = (result.stderr ?? "") + (result.stdout ?? "");
      expect(combined).toContain(planPath);
      expect(combined).toMatch(/Draft/);
      expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
    });
  });

  describe("phax run against a stale Approved plan", () => {
    let tmpRepoRoot: string;

    afterEach(() => {
      if (tmpRepoRoot) rmSync(tmpRepoRoot, { recursive: true, force: true });
    });

    it("Approved docs/plans/ plan with no approval record: exit 12, message names the missing record and the approve remedy, no stack trace", () => {
      // Canonicalize: `git rev-parse --show-toplevel` (used by loadConfig)
      // resolves symlinks, so tmpRepoRoot must match or the plan path's
      // repo-relative classification silently fails on macOS's /tmp symlink.
      tmpRepoRoot = realpathSync(mkdtempSync(join(tmpdir(), "phax-cli-errors-stale-")));
      execSync("git init -q", { cwd: tmpRepoRoot });
      execSync('git config user.email "test@example.com"', { cwd: tmpRepoRoot });
      execSync('git config user.name "Test"', { cwd: tmpRepoRoot });

      writeFileSync(
        join(tmpRepoRoot, "phax.json"),
        JSON.stringify({
          version: 1,
          name: "test",
          state: { root: join(tmpRepoRoot, ".phax-state") },
          gateProfiles: { fast: ["true"] },
        }),
      );

      mkdirSync(join(tmpRepoRoot, "docs", "plans"), { recursive: true });
      const planRelPath = "docs/plans/stale-gate-test.md";
      const planPath = join(tmpRepoRoot, planRelPath);
      writeFileSync(
        planPath,
        [
          "# Stale gate test plan",
          "",
          "Status: Approved",
          "Source-Spec: (none)",
          "",
          "---",
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
      execSync("git add -A", { cwd: tmpRepoRoot });
      execSync('git commit -q -m "seed"', { cwd: tmpRepoRoot });

      const result = spawnSync("tsx", [mainTs, "run", "--plan", planPath], {
        cwd: tmpRepoRoot,
        encoding: "utf8",
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
