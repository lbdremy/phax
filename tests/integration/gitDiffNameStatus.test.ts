import { rm, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, GitError } from "../../src/ports/git.js";
import type { BranchName, WorktreePath } from "../../src/domain/branded.js";

function runGit(args: string, cwd: string): void {
  execSync(`git ${args}`, { cwd, stdio: "pipe" });
}

describe("NodeGitLayer.diffNameStatus", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-git-diff-test-"));
    runGit("init", repoDir);
    runGit("config --local user.email test@phax.test", repoDir);
    runGit("config --local user.name 'phax test'", repoDir);

    // Initial commit so HEAD^ is valid on the next commit
    await writeFile(join(repoDir, "README.md"), "# test\n");
    runGit("add .", repoDir);
    runGit("commit -m 'chore: initial commit'", repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns added, modified, and deleted entries for HEAD^..HEAD", async () => {
    // Second commit: add files we'll modify/delete later
    await writeFile(join(repoDir, "to-delete.txt"), "bye\n");
    await writeFile(join(repoDir, "to-modify.ts"), "export const x = 1;\n");
    runGit("add .", repoDir);
    runGit("commit -m 'chore: setup'", repoDir);

    // Third commit: the one we're diffing (HEAD^..HEAD)
    await writeFile(join(repoDir, "new.ts"), "export const y = 2;\n");
    await writeFile(join(repoDir, "to-modify.ts"), "export const x = 99;\n");
    runGit("rm to-delete.txt", repoDir);
    runGit("add .", repoDir);
    runGit("commit -m 'feat: changes'", repoDir);

    const entries = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.diffNameStatus(repoDir as WorktreePath)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.status]));
    expect(byPath["new.ts"]).toBe("added");
    expect(byPath["to-modify.ts"]).toBe("modified");
    expect(byPath["to-delete.txt"]).toBe("deleted");
    // README.md was touched in an earlier commit, not HEAD^..HEAD
    expect(byPath["README.md"]).toBeUndefined();
  });

  it("returns only the modified file when a single file is changed", async () => {
    await writeFile(join(repoDir, "README.md"), "# updated\n");
    runGit("add .", repoDir);
    runGit("commit -m 'update readme'", repoDir);

    const entries = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.diffNameStatus(repoDir as WorktreePath)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe("README.md");
    expect(entries[0]?.status).toBe("modified");
  });

  it("returns a renamed entry for a renamed file", async () => {
    await writeFile(join(repoDir, "old-name.ts"), "export const z = 3;\n");
    runGit("add .", repoDir);
    runGit("commit -m 'add old-name.ts'", repoDir);

    runGit("mv old-name.ts new-name.ts", repoDir);
    runGit("commit -m 'rename file'", repoDir);

    const entries = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.diffNameStatus(repoDir as WorktreePath)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    const renamed = entries.find((e) => e.status === "renamed");
    expect(renamed).toBeDefined();
    expect(renamed?.path).toBe("new-name.ts");
    expect(renamed?.oldPath).toBe("old-name.ts");
  });

  it("deletes a branch when forced", async () => {
    runGit("branch phase-test", repoDir);

    await Effect.runPromise(
      Effect.flatMap(Git, (git) =>
        git.deleteBranch("phase-test" as BranchName, true, repoDir),
      ).pipe(Effect.provide(NodeGitLayer)),
    );

    expect(() => runGit("rev-parse --verify --quiet phase-test", repoDir)).toThrow();
  });

  it("returns GitError when deleting a missing branch without force", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.flatMap(Git, (git) =>
          git.deleteBranch("missing-branch" as BranchName, false, repoDir),
        ).pipe(Effect.provide(NodeGitLayer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError);
      expect(result.left.command).toBe("git branch -d missing-branch");
    }
  });
});

describe("NodeGitLayer.remoteExists and pushBranch", () => {
  let repoDir: string;
  let bareRemoteDir: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-git-push-test-"));
    bareRemoteDir = mkdtempSync(join(tmpdir(), "phax-git-push-remote-"));

    execSync("git init --bare", { cwd: bareRemoteDir, stdio: "pipe" });

    runGit("init", repoDir);
    runGit("config --local user.email test@phax.test", repoDir);
    runGit("config --local user.name 'phax test'", repoDir);
    runGit(`remote add origin ${bareRemoteDir}`, repoDir);

    await writeFile(join(repoDir, "README.md"), "# test\n");
    runGit("add .", repoDir);
    runGit("commit -m 'chore: initial'", repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(bareRemoteDir, { recursive: true, force: true });
  });

  it("remoteExists returns true for a configured remote", async () => {
    const result = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.remoteExists("origin", repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );
    expect(result).toBe(true);
  });

  it("remoteExists returns false for an unknown remote", async () => {
    const result = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.remoteExists("upstream", repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );
    expect(result).toBe(false);
  });

  it("pushBranch pushes the branch to the remote successfully", async () => {
    await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.pushBranch("main" as BranchName, "origin", repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    const refs = execSync("git branch", { cwd: bareRemoteDir, stdio: "pipe" }).toString();
    expect(refs).toContain("main");
  });

  it("pushBranch is idempotent — re-push of an up-to-date branch succeeds", async () => {
    await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.pushBranch("main" as BranchName, "origin", repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.pushBranch("main" as BranchName, "origin", repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );
  });
});
