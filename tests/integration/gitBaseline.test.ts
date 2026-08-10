import { rm, writeFile, appendFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git } from "../../src/ports/git.js";

function runGit(args: string, cwd: string): void {
  execSync(`git ${args}`, { cwd, stdio: "pipe" });
}

function headSha(cwd: string): string {
  return execSync("git rev-parse HEAD", { cwd, stdio: "pipe" }).toString().trim();
}

describe("NodeGitLayer baseline operations", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-git-baseline-test-"));
    runGit("init", repoDir);
    runGit("config --local user.email test@phax.test", repoDir);
    runGit("config --local user.name 'phax test'", repoDir);

    await writeFile(join(repoDir, "README.md"), "# test\n");
    runGit("add .", repoDir);
    runGit("commit -m 'chore: initial commit'", repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("headCommit returns the sha git rev-parse HEAD reports", async () => {
    const expected = headSha(repoDir);

    const sha = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.headCommit(repoDir)).pipe(Effect.provide(NodeGitLayer)),
    );

    expect(sha).toBe(expected);
  });

  it("commitExists returns true for HEAD", async () => {
    const head = headSha(repoDir);

    const exists = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.commitExists(head, repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    expect(exists).toBe(true);
  });

  it("commitExists returns false for a well-formed unknown sha", async () => {
    const unknown = "a".repeat(40);

    const exists = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.commitExists(unknown, repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    expect(exists).toBe(false);
  });

  it("changedFilesSince lists exactly the files touched by a follow-up commit", async () => {
    const baseline = headSha(repoDir);

    await writeFile(join(repoDir, "new.ts"), "export const y = 2;\n");
    runGit("add .", repoDir);
    runGit("commit -m 'feat: add new.ts'", repoDir);

    const files = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.changedFilesSince(baseline, repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    expect(files).toEqual(["new.ts"]);
  });

  it("changedFilesSince includes an uncommitted working-tree edit", async () => {
    const baseline = headSha(repoDir);

    await appendFile(join(repoDir, "README.md"), "more\n");

    const files = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.changedFilesSince(baseline, repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    expect(files).toEqual(["README.md"]);
  });

  it("changedFilesSince excludes an untracked file", async () => {
    const baseline = headSha(repoDir);

    await writeFile(join(repoDir, "untracked.txt"), "hello\n");

    const files = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.changedFilesSince(baseline, repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    expect(files).toEqual([]);
  });

  it("changedFilesSince returns empty for baseline == HEAD with a clean tree", async () => {
    const baseline = headSha(repoDir);

    const files = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.changedFilesSince(baseline, repoDir)).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

    expect(files).toEqual([]);
  });
});
