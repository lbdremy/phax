import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git } from "../../src/ports/git.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The real git adapter's `diffNoIndex`: the body diff decide shows before it
// writes. Two files outside any index; exit 1 (they differ) is the diff.

const LABEL = "docs/specs/log-rotation.md";

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
        return yield* (yield* Git).diffNoIndex(repoDir, before, after, LABEL);
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

  it("names the label on both sides of the header, never the compared files", async () => {
    const before = join(repoDir, "before.md");
    const after = join(repoDir, "after.md");
    // A removed line that reads like a header must stay as it is.
    writeFileSync(before, "-- kept\n++ kept\nold\n");
    writeFileSync(after, "-- kept\n++ kept\nnew\n");
    writeFileSync(join(repoDir, "removed.md"), "-- gone\n");
    writeFileSync(join(repoDir, "empty.md"), "");

    const result = await diff(before, after);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    const lines = result.right.split("\n");
    expect(lines[0]).toBe(`diff --git a/${LABEL} b/${LABEL}`);
    expect(lines).toContain(`--- a/${LABEL}`);
    expect(lines).toContain(`+++ b/${LABEL}`);
    expect(result.right).not.toContain(repoDir);
    expect(result.right).not.toContain("before.md");
    expect(result.right).not.toContain("after.md");
    expect(lines).toContain("-old");
    expect(lines).toContain("+new");

    const hunk = await diff(join(repoDir, "removed.md"), join(repoDir, "empty.md"));
    expect(Either.isRight(hunk)).toBe(true);
    if (Either.isLeft(hunk)) return;
    expect(hunk.right.split("\n")).toContain("--- gone");
  });

  it("ignores the user's external diff, textconv and color config", async () => {
    const tool = join(repoDir, "external-diff.sh");
    writeFileSync(tool, "#!/bin/sh\necho EXTERNAL\n");
    chmodSync(tool, 0o755);
    writeFileSync(join(repoDir, ".gitattributes"), "*.md diff=upper\n");
    for (const [key, value] of [
      ["diff.external", tool],
      ["diff.upper.textconv", "tr a-z A-Z <"],
      ["color.ui", "always"],
      ["color.diff", "always"],
    ] as const) {
      execFileSync("git", ["config", key, value], { cwd: repoDir, stdio: "pipe" });
    }
    const before = join(repoDir, "before.md");
    const after = join(repoDir, "after.md");
    writeFileSync(before, "old\n");
    writeFileSync(after, "new\n");

    const result = await diff(before, after);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right).not.toContain("EXTERNAL");
    expect(result.right).not.toContain("OLD");
    expect(result.right).not.toContain("\u001b[");
    expect(result.right.split("\n")).toEqual(expect.arrayContaining(["-old", "+new"]));
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
