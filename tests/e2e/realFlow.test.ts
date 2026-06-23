import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempEnv, type TempEnv } from "./helpers/tempEnv.js";
import { runCli } from "./helpers/runCli.js";
import { printArtifacts } from "./helpers/artifacts.js";
import { E2E_PROVIDERS, expectedSelectedProvider, probeProvider } from "./helpers/providers.js";

// Explicit opt-in (PHAX_E2E_RUN=1) so the suite never fires accidentally in CI
// without auth. Each provider additionally gates on its executable being
// reachable, so an operator only runs the providers they have installed.
const E2E_ENABLED = process.env["PHAX_E2E_RUN"] === "1";

for (const provider of E2E_PROVIDERS) {
  const shouldRun = E2E_ENABLED && probeProvider(provider.executable);
  const securityMode = provider.securityMode;

  describe.skipIf(!shouldRun)(`phax real E2E flow [${provider.id}] (${securityMode})`, () => {
    let env: TempEnv;
    let shortName: string;
    let failed = false;

    beforeAll(() => {
      env = createTempEnv();
    });

    afterAll(() => {
      if (!env) return;
      if (failed) {
        printArtifacts({ repoDir: env.repoDir, phaxHome: env.phaxHome, shortName }, "tests failed");
      } else {
        env.cleanup();
      }
    });

    it(
      "run extracts plan.md, executes all phases, and reaches review_open",
      { timeout: 600_000 },
      () => {
        const result = runCli(
          [
            "run",
            "--plan",
            "plan.md",
            "--provider-priority",
            provider.id,
            "--security",
            securityMode,
            "--verbose",
            "--trace",
          ],
          env.repoDir,
          { timeout: 590_000 },
        );

        if (result.exitCode !== 0) {
          failed = true;
          printArtifacts(
            { repoDir: env.repoDir, phaxHome: env.phaxHome },
            `run failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
          );
        }

        expect(
          result.exitCode,
          `run output:\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
        ).toBe(0);

        // shortName is extracted from plan.md by `phax run` — discover it from
        // the runs directory rather than relying on a separate extract-plan step.
        const runsDir = join(env.phaxHome, "runs");
        const runDirs = readdirSync(runsDir).filter((d) => !d.startsWith("."));
        expect(runDirs.length, `expected one run dir, got ${runDirs.join(", ")}`).toBe(1);
        shortName = runDirs[0] as string;

        const runStatusPath = join(runsDir, shortName, "run-status.json");
        expect(existsSync(runStatusPath), "run-status.json should exist").toBe(true);

        const runStatus = JSON.parse(readFileSync(runStatusPath, "utf8")) as {
          state: string;
          phasesCount: number;
        };
        expect(runStatus.state).toBe("review_open");
        expect(runStatus.phasesCount).toBe(2);

        const planJsonPath = join(runsDir, shortName, "phax-plan.json");
        expect(existsSync(planJsonPath), "run folder should snapshot phax-plan.json").toBe(true);
        const plan = JSON.parse(readFileSync(planJsonPath, "utf8")) as {
          run: { branch: string };
        };
        expect(plan.run.branch).toBe(`phax/${shortName}`);
      },
    );

    it("each phase recorded the expected security posture and provider", () => {
      const runPath = join(env.phaxHome, "runs", shortName);
      const expectedProvider = expectedSelectedProvider(provider.id, securityMode);

      for (const phaseDir of ["phase-01", "phase-02"]) {
        const securityPath = join(runPath, phaseDir, "security.json");
        expect(existsSync(securityPath), `${phaseDir}/security.json should exist`).toBe(true);
        const posture = JSON.parse(readFileSync(securityPath, "utf8")) as {
          mode: string;
          provider: string;
        };
        expect(posture.mode, `${phaseDir} should run in ${securityMode} mode`).toBe(securityMode);
        expect(
          posture.provider,
          `${phaseDir} forced ${provider.id} under ${securityMode} should resolve to ${expectedProvider}`,
        ).toBe(expectedProvider);
      }
    });

    it("phase folders and status files exist after run", () => {
      const runPath = join(env.phaxHome, "runs", shortName);

      expect(existsSync(join(runPath, "phase-01")), "phase-01 folder should exist").toBe(true);
      expect(existsSync(join(runPath, "phase-02")), "phase-02 folder should exist").toBe(true);

      const terminalStates = new Set(["cleaned_up", "review_open", "committed", "passed"]);
      for (const phaseDir of ["phase-01", "phase-02"]) {
        const statusPath = join(runPath, phaseDir, "status.json");
        expect(existsSync(statusPath), `${phaseDir}/status.json should exist`).toBe(true);
        const status = JSON.parse(readFileSync(statusPath, "utf8")) as { state: string };
        expect(
          terminalStates.has(status.state),
          `${phaseDir} state "${status.state}" should be terminal`,
        ).toBe(true);
      }
    });

    it("phase-01 produced a phase-handoff.md", () => {
      const handoffPath = join(env.phaxHome, "runs", shortName, "phase-01", "phase-handoff.md");
      expect(existsSync(handoffPath), "phase-01/phase-handoff.md should exist").toBe(true);
      const content = readFileSync(handoffPath, "utf8");
      expect(content.length, "handoff should not be empty").toBeGreaterThan(0);
    });

    it("session-info reports review_open state and a session ID", () => {
      const result = runCli(["session-info", shortName], env.repoDir);

      if (result.exitCode !== 0) {
        failed = true;
      }

      expect(result.exitCode, `session-info stderr:\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("review_open");
    });

    it("ls lists the run", () => {
      const result = runCli(["ls"], env.repoDir);

      if (result.exitCode !== 0) {
        failed = true;
      }

      expect(result.exitCode, `ls stderr:\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(shortName);
    });

    it("archive transitions run state to archived", () => {
      const result = runCli(["archive", shortName], env.repoDir);

      if (result.exitCode !== 0) {
        failed = true;
        printArtifacts(
          { repoDir: env.repoDir, phaxHome: env.phaxHome, shortName },
          `archive failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
        );
      }

      expect(result.exitCode, `archive stderr:\n${result.stderr}`).toBe(0);

      // archive moves the run folder from runs/ to archive/{short}/runs/
      // and the worktrees folder from worktrees/ to archive/{short}/worktrees/.
      expect(existsSync(join(env.phaxHome, "runs", shortName))).toBe(false);

      const runStatusPath = join(env.phaxHome, "archive", shortName, "runs", "run-status.json");
      expect(existsSync(runStatusPath), "archived run-status.json should exist under runs/").toBe(
        true,
      );
      const runStatus = JSON.parse(readFileSync(runStatusPath, "utf8")) as { state: string };
      expect(runStatus.state).toBe("archived");

      // Worktrees subfolder should exist inside the archive umbrella.
      const archivedWorktreesDir = join(env.phaxHome, "archive", shortName, "worktrees");
      expect(
        existsSync(archivedWorktreesDir),
        "archived worktrees directory should exist under archive/{short}/worktrees/",
      ).toBe(true);
    });
  });
}

// The standalone extract-plan command does not take --provider-priority; it
// routes via default priority and the terminal claude-code fallback. Gate it on
// the claude executable so it exercises the command surface independently of the
// per-provider run suites above.
describe.skipIf(!(E2E_ENABLED && probeProvider("claude")))("phax extract-plan (standalone)", () => {
  let env: TempEnv;
  let failed = false;

  beforeAll(() => {
    env = createTempEnv();
  });

  afterAll(() => {
    if (!env) return;
    if (failed) {
      printArtifacts({ repoDir: env.repoDir, phaxHome: env.phaxHome }, "tests failed");
    } else {
      env.cleanup();
    }
  });

  it("writes a valid phax-plan.json with 2 phases", { timeout: 180_000 }, () => {
    const planJsonPath = join(env.repoDir, "phax-plan.json");

    const result = runCli(
      ["extract-plan", "--plan-md", "plan.md", "--out", "phax-plan.json"],
      env.repoDir,
    );

    if (result.exitCode !== 0) {
      failed = true;
      printArtifacts(
        { repoDir: env.repoDir, phaxHome: env.phaxHome },
        `extract-plan failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
      );
    }

    expect(result.exitCode, `extract-plan stderr:\n${result.stderr}`).toBe(0);
    expect(existsSync(planJsonPath), "phax-plan.json should exist").toBe(true);

    const plan = JSON.parse(readFileSync(planJsonPath, "utf8")) as {
      version: number;
      run: { shortName: string; branch: string };
      phases: unknown[];
    };
    expect(plan.version).toBe(1);
    expect(plan.run.shortName).toBeTruthy();
    expect(plan.run.branch).toBe(`phax/${plan.run.shortName}`);
    expect(plan.phases.length).toBe(2);
  });
});
