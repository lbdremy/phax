import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ResolvedBackend } from "./backends.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/minimal-repo", import.meta.url));

export interface TempEnv {
  readonly repoDir: string;
  readonly phaxHome: string;
  cleanup(): void;
}

export function createTempEnv(backend?: ResolvedBackend): TempEnv {
  const base = tmpdir();
  const repoDir = mkdtempSync(join(base, "phax-e2e-repo-"));
  const phaxHome = mkdtempSync(join(base, "phax-e2e-home-"));

  cpSync(FIXTURE_DIR, repoDir, { recursive: true });

  // Override state.root to the isolated phaxHome so the test never touches ~/.phax.
  const phaxConfigPath = join(repoDir, "phax.json");
  const config = JSON.parse(readFileSync(phaxConfigPath, "utf8")) as {
    state: { root: string };
  };
  config.state.root = phaxHome;
  writeFileSync(phaxConfigPath, JSON.stringify(config, null, 2));

  // Substitute **Recommended model:** lines in plan.md when a backend is selected,
  // so each phase is routed to a tier that includes the target provider.
  if (backend) {
    const planPath = join(repoDir, "plan.md");
    const planContent = readFileSync(planPath, "utf8");
    const patched = planContent.replace(
      /\*\*Recommended model:\*\* .+/g,
      `**Recommended model:** ${backend.entry.requestedModel}`,
    );
    writeFileSync(planPath, patched);
  }

  // Initialise a real git repo so phax can create worktrees
  const gitOpts = { cwd: repoDir, stdio: "pipe" as const };
  execSync("git init", gitOpts);
  execSync("git config --local user.email e2e@phax.test", gitOpts);
  execSync("git config --local user.name 'phax E2E'", gitOpts);
  execSync("git add .", gitOpts);
  execSync("git commit -m 'chore: initial commit'", gitOpts);

  return {
    repoDir,
    phaxHome,
    cleanup() {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(phaxHome, { recursive: true, force: true });
    },
  };
}
