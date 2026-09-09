import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

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
  execFileSync("git", ["config", "--local", "maintenance.auto", "false"], {
    cwd: repoDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "--local", "gc.auto", "0"], { cwd: repoDir, stdio: "pipe" });
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
