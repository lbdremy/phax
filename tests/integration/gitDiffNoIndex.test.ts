import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git } from "../../src/ports/git.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The real git adapter's `diffNoIndex`: the body diff decide shows before it
// writes. Two files outside any index; exit 1 (they differ) is the diff.

let repoDir: string;

beforeEach(() => {
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-diff-no-index-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
  disableGitAutoMaintenance(repoDir);
});

afterEach(() => {
  removeTempDir(repoDir);
});

function diff(before: string, after: string) {
  return Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        return yield* (yield* Git).diffNoIndex(repoDir, before, after);
      }).pipe(Effect.provide(NodeGitLayer)),
    ),
  );
}

describe("Git.diffNoIndex", () => {
  it("returns the unified diff of two differing files, without color", async () => {
    const before = join(repoDir, "before.md");
    const after = join(repoDir, "after.md");
    writeFileSync(before, "# Log rotation\n\n## 9. Open questions\n\n### Q1 — Keep?\n");
    writeFileSync(after, "# Log rotation\n\n## 9. Open questions\n\nNone.\n");

    const result = await diff(before, after);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right).toContain("--- a/");
    expect(result.right).toContain("+++ b/");
    expect(result.right).toContain("-### Q1 — Keep?");
    expect(result.right).toContain("+None.");
    expect(result.right).not.toContain("\u001b[");
  });

  it("returns an empty diff for identical files", async () => {
    const before = join(repoDir, "before.md");
    const after = join(repoDir, "after.md");
    writeFileSync(before, "same\n");
    writeFileSync(after, "same\n");

    expect(await diff(before, after)).toEqual(Either.right(""));
  });

  it("fails on a missing file", async () => {
    const before = join(repoDir, "before.md");
    writeFileSync(before, "only one\n");

    const result = await diff(before, join(repoDir, "missing.md"));

    expect(Either.isLeft(result)).toBe(true);
  });
});
