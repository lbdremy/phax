import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, type GitOps } from "../../src/ports/git.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

const withGit = <A>(f: (ops: GitOps) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(Git, f).pipe(Effect.provide(NodeGitLayer)));

let repoDir: string;

// Commit everything with both author and committer dated at `instant`, so
// `--before` sees a known history whatever the wall clock says.
function commitAt(instant: string, message: string): string {
  const env = { ...process.env, GIT_AUTHOR_DATE: instant, GIT_COMMITTER_DATE: instant };
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", message], { cwd: repoDir, stdio: "pipe", env });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, stdio: "pipe" })
    .toString()
    .trim();
}

beforeEach(() => {
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-git-blob-sizes-test-")));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: repoDir, stdio: "pipe" });
  disableGitAutoMaintenance(repoDir);
  execFileSync("git", ["config", "--local", "user.email", "test@phax.test"], { cwd: repoDir });
  execFileSync("git", ["config", "--local", "user.name", "phax test"], { cwd: repoDir });
});

afterEach(() => {
  removeTempDir(repoDir);
});

describe("NodeGitLayer.commitBefore and blobSizes", () => {
  it("reads blob sizes at the last commit before an instant, not at HEAD", async () => {
    writeFileSync(join(repoDir, "a.ts"), "x".repeat(10));
    writeFileSync(join(repoDir, "b c.ts"), "y".repeat(3));
    const first = commitAt("2026-09-01T10:00:00Z", "first");
    writeFileSync(join(repoDir, "a.ts"), "x".repeat(250));
    commitAt("2026-09-10T10:00:00Z", "second");

    const base = await withGit((git) => git.commitBefore(repoDir, "2026-09-05T00:00:00.000Z"));
    expect(base).toBe(first);

    const sizes = await withGit((git) => git.blobSizes(repoDir, first, ["a.ts", "b c.ts"]));
    expect(sizes).toEqual({ "a.ts": 10, "b c.ts": 3 });
  });

  it("counts 0 for a path absent at the commit", async () => {
    writeFileSync(join(repoDir, "a.ts"), "abc");
    const first = commitAt("2026-09-01T10:00:00Z", "first");

    const sizes = await withGit((git) =>
      git.blobSizes(repoDir, first, ["missing.ts", "a.ts", "src/also-missing.ts"]),
    );
    expect(sizes).toEqual({ "missing.ts": 0, "a.ts": 3, "src/also-missing.ts": 0 });
  });

  it("counts 0 for a directory, as the plan's own sizing does", async () => {
    mkdirSync(join(repoDir, "src"));
    writeFileSync(join(repoDir, "src", "a.ts"), "x".repeat(40));
    writeFileSync(join(repoDir, "b.ts"), "abc");
    const first = commitAt("2026-09-01T10:00:00Z", "first");

    const sizes = await withGit((git) => git.blobSizes(repoDir, first, ["src", "b.ts"]));
    expect(sizes).toEqual({ src: 0, "b.ts": 3 });
  });

  it("gives null for an instant before the first commit", async () => {
    writeFileSync(join(repoDir, "a.ts"), "abc");
    commitAt("2026-09-01T10:00:00Z", "first");

    const base = await withGit((git) => git.commitBefore(repoDir, "2026-08-01T00:00:00.000Z"));
    expect(base).toBeNull();
  });

  it("answers an empty path list without asking git", async () => {
    writeFileSync(join(repoDir, "a.ts"), "abc");
    const first = commitAt("2026-09-01T10:00:00Z", "first");

    const sizes = await withGit((git) => git.blobSizes(repoDir, first, []));
    expect(sizes).toEqual({});
  });
});
