import { rm, writeFile } from "node:fs/promises";
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

describe("NodeGitLayer.commitPaths", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-git-commit-paths-test-"));
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

  it("commits only the given paths, leaving an unrelated dirty file untouched", async () => {
    await writeFile(join(repoDir, "target.txt"), "committed\n");
    await writeFile(join(repoDir, "unrelated.txt"), "left dirty\n");
    runGit("add target.txt unrelated.txt", repoDir);

    await Effect.runPromise(
      Effect.flatMap(Git, (git) =>
        git.commitPaths(repoDir, ["target.txt"], "chore: commit target", "body"),
      ).pipe(Effect.provide(NodeGitLayer)),
    );

    const committed = execSync("git show --name-status HEAD", {
      cwd: repoDir,
      stdio: "pipe",
    }).toString();
    expect(committed).toContain("target.txt");
    expect(committed).not.toContain("unrelated.txt");

    const status = execSync("git status --porcelain", { cwd: repoDir, stdio: "pipe" }).toString();
    expect(status).toContain("unrelated.txt");
  });

  it("commits a delete+create pair (archive-move shape) in one commit", async () => {
    await writeFile(join(repoDir, "source.txt"), "moving\n");
    runGit("add source.txt", repoDir);
    runGit("commit -m 'chore: add source'", repoDir);

    execSync("mv source.txt dest.txt", { cwd: repoDir, stdio: "pipe" });

    await Effect.runPromise(
      Effect.flatMap(Git, (git) =>
        git.commitPaths(repoDir, ["source.txt", "dest.txt"], "chore: archive move", "body"),
      ).pipe(Effect.provide(NodeGitLayer)),
    );

    const committed = execSync("git show --name-status HEAD", {
      cwd: repoDir,
      stdio: "pipe",
    }).toString();
    expect(committed).toMatch(/D\s+source\.txt[\s\S]*A\s+dest\.txt|R\d*\s+source\.txt\s+dest\.txt/);

    const status = execSync("git status --porcelain", { cwd: repoDir, stdio: "pipe" }).toString();
    expect(status.trim()).toBe("");
  });

  it("commits an untracked file", async () => {
    await writeFile(join(repoDir, "new-file.txt"), "brand new\n");

    await Effect.runPromise(
      Effect.flatMap(Git, (git) =>
        git.commitPaths(repoDir, ["new-file.txt"], "chore: add new file", "body"),
      ).pipe(Effect.provide(NodeGitLayer)),
    );

    const committed = execSync("git show --name-status HEAD", {
      cwd: repoDir,
      stdio: "pipe",
    }).toString();
    expect(committed).toMatch(/A\s+new-file\.txt/);
  });
});

describe("NodeGitLayer.dirtyPaths", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-git-dirty-paths-test-"));
    runGit("init", repoDir);
    runGit("config --local user.email test@phax.test", repoDir);
    runGit("config --local user.name 'phax test'", repoDir);

    await writeFile(join(repoDir, "clean.txt"), "clean\n");
    await writeFile(join(repoDir, "modified.txt"), "original\n");
    await writeFile(join(repoDir, "staged.txt"), "original\n");
    runGit("add .", repoDir);
    runGit("commit -m 'chore: initial commit'", repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("reports exactly the dirty subset for modified, staged, untracked, and clean paths", async () => {
    await writeFile(join(repoDir, "modified.txt"), "changed\n");
    await writeFile(join(repoDir, "staged.txt"), "changed\n");
    runGit("add staged.txt", repoDir);
    await writeFile(join(repoDir, "untracked.txt"), "brand new\n");

    const result = await Effect.runPromise(
      Effect.flatMap(Git, (git) =>
        git.dirtyPaths(repoDir, ["clean.txt", "modified.txt", "staged.txt", "untracked.txt"]),
      ).pipe(Effect.provide(NodeGitLayer)),
    );

    expect(new Set(result)).toEqual(new Set(["modified.txt", "staged.txt", "untracked.txt"]));
  });

  it("returns empty output for empty input without invoking git", async () => {
    const result = await Effect.runPromise(
      Effect.flatMap(Git, (git) => git.dirtyPaths(repoDir, [])).pipe(Effect.provide(NodeGitLayer)),
    );

    expect(result).toEqual([]);
  });
});
