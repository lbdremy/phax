import { mkdtempSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, type GitError } from "../../src/ports/git.js";
import { decodeBranchName, type BranchName } from "../../src/domain/branded.js";

const RECORDS_BRANCH = ((): BranchName => {
  const decoded = decodeBranchName("phax/records/v1");
  if (Either.isLeft(decoded)) throw new Error("phax/records/v1 must be a valid branch name");
  return decoded.right;
})();

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function run<A>(effect: Effect.Effect<A, GitError, Git>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, NodeGitLayer));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("NodeGitLayer object plumbing", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-git-object-plumbing-"));
    git(["init"], repoDir);
    git(["config", "--local", "user.email", "test@phax.test"], repoDir);
    git(["config", "--local", "user.name", "phax test"], repoDir);
    await writeFile(join(repoDir, "README.md"), "# test\n");
    git(["add", "."], repoDir);
    git(["commit", "-m", "chore: initial commit"], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("leaves a dirty working tree and the repo index byte-for-byte unchanged", async () => {
    // Dirty the working tree three ways: a modified tracked file, an untracked
    // file, and a staged addition (which mutates .git/index).
    await writeFile(join(repoDir, "README.md"), "# changed\n");
    await writeFile(join(repoDir, "untracked.txt"), "new\n");
    await writeFile(join(repoDir, "staged.txt"), "to stage\n");
    git(["add", "staged.txt"], repoDir);

    const statusBefore = git(["status", "--porcelain"], repoDir);
    const indexBefore = readFileSync(join(repoDir, ".git", "index"));

    await run(
      Effect.flatMap(Git, (g) =>
        g.writeTreeCommit({
          repo: repoDir,
          branch: RECORDS_BRANCH,
          message: "record: run-1 phase-01",
          files: [{ path: "run-1/phase-01/record.json", content: encoder.encode("{}\n") }],
        }),
      ),
    );

    expect(git(["status", "--porcelain"], repoDir)).toBe(statusBefore);
    expect(readFileSync(join(repoDir, ".git", "index")).equals(indexBefore)).toBe(true);
  });

  it("creates an orphan branch on first write and parents onto it on the second", async () => {
    const first = await run(
      Effect.flatMap(Git, (g) =>
        g.writeTreeCommit({
          repo: repoDir,
          branch: RECORDS_BRANCH,
          message: "record: first",
          files: [{ path: "run-1/phase-01/record.json", content: encoder.encode("first\n") }],
        }),
      ),
    );

    // A root commit's rev-list --parents line is just the commit sha (no parents).
    expect(git(["rev-list", "--parents", "-n", "1", first], repoDir).trim()).toBe(first);
    expect(git(["rev-parse", "--verify", "refs/heads/phax/records/v1"], repoDir).trim()).toBe(
      first,
    );

    const second = await run(
      Effect.flatMap(Git, (g) =>
        g.writeTreeCommit({
          repo: repoDir,
          branch: RECORDS_BRANCH,
          message: "record: second",
          files: [{ path: "run-1/phase-02/record.json", content: encoder.encode("second\n") }],
        }),
      ),
    );

    // The second commit lists `first` as its sole parent.
    expect(git(["rev-list", "--parents", "-n", "1", second], repoDir).trim()).toBe(
      `${second} ${first}`,
    );
    expect(git(["rev-parse", "--verify", "refs/heads/phax/records/v1"], repoDir).trim()).toBe(
      second,
    );
  });

  it("reads the written tree back through the read operations and through plain git", async () => {
    const files = [
      { path: "run-1/phase-01/record.json", content: encoder.encode('{"shape":"full"}\n') },
      { path: "run-1/phase-01/prompt.md", content: encoder.encode("# Prompt\n") },
    ];

    await run(
      Effect.flatMap(Git, (g) =>
        g.writeTreeCommit({
          repo: repoDir,
          branch: RECORDS_BRANCH,
          message: "record: readable",
          files,
        }),
      ),
    );

    const sha = await run(Effect.flatMap(Git, (g) => g.resolveRef(repoDir, "phax/records/v1")));
    expect(sha).not.toBeNull();

    const entries = await run(Effect.flatMap(Git, (g) => g.readTree(repoDir, sha!)));
    expect(entries.map((e) => e.path)).toEqual([
      "run-1/phase-01/prompt.md",
      "run-1/phase-01/record.json",
    ]);
    expect(entries.every((e) => e.type === "blob")).toBe(true);

    const promptEntry = entries.find((e) => e.path === "run-1/phase-01/prompt.md")!;
    const promptBytes = await run(Effect.flatMap(Git, (g) => g.readBlob(repoDir, promptEntry.oid)));
    expect(decoder.decode(promptBytes)).toBe("# Prompt\n");

    // The same blob is readable by plain git outside phax.
    expect(git(["cat-file", "blob", promptEntry.oid], repoDir)).toBe("# Prompt\n");
    expect(git(["ls-tree", "-r", "--name-only", sha!], repoDir)).toContain(
      "run-1/phase-01/prompt.md",
    );
  });

  it("does not switch the checked-out branch", async () => {
    git(["checkout", "-b", "feature"], repoDir);
    const branchBefore = git(["rev-parse", "--abbrev-ref", "HEAD"], repoDir).trim();
    const headBefore = git(["rev-parse", "HEAD"], repoDir).trim();

    await run(
      Effect.flatMap(Git, (g) =>
        g.writeTreeCommit({
          repo: repoDir,
          branch: RECORDS_BRANCH,
          message: "record: no switch",
          files: [{ path: "run-1/phase-01/record.json", content: encoder.encode("x\n") }],
        }),
      ),
    );

    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], repoDir).trim()).toBe(branchBefore);
    expect(git(["rev-parse", "HEAD"], repoDir).trim()).toBe(headBefore);
  });

  it("resolves a missing ref to null", async () => {
    const sha = await run(
      Effect.flatMap(Git, (g) => g.resolveRef(repoDir, "refs/heads/phax/records/v1")),
    );
    expect(sha).toBeNull();
  });
});
