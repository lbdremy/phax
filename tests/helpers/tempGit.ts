import { rmSync } from "node:fs";
import { boundedOutput, GIT_BOUND_MS } from "./boundedSpawn.js";

/**
 * Stop a fixture repo from leaving background work behind.
 *
 * Commands that create objects — `commit`, and `receive-pack` on the far side
 * of a push — spawn a detached `git maintenance run --auto --quiet`. That
 * process can still be writing into `.git` when the test's teardown removes
 * the tree, and the removal then fails with `ENOTEMPTY`.
 *
 * Call this on every repo a test creates: the working repo, a bare remote, and
 * any clone made mid-test.
 */
export function disableGitAutoMaintenance(repoDir: string): void {
  boundedOutput("git", ["config", "--local", "maintenance.auto", "false"], {
    boundMs: GIT_BOUND_MS,
    cwd: repoDir,
  });
  boundedOutput("git", ["config", "--local", "gc.auto", "0"], {
    boundMs: GIT_BOUND_MS,
    cwd: repoDir,
  });
}

/**
 * Remove a temp directory, tolerating a writer that races the walk.
 *
 * Node's recursive removal does not retry by default, so a single entry
 * appearing after its parent was enumerated fails the whole call. Undefined is
 * accepted so a teardown can run before its `beforeEach` ever assigned a path.
 */
export function removeTempDir(dir: string | undefined): void {
  if (dir === undefined) return;
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
