import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
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
    Effect.result(
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

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(result.success).toContain("--- a/");
    expect(result.success).toContain("+++ b/");
    expect(result.success).toContain("-### Q1 — Keep?");
    expect(result.success).toContain("+None.");
    expect(result.success).not.toContain("\u001b[");
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

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    const lines = result.success.split("\n");
    expect(lines[0]).toBe(`diff --git a/${LABEL} b/${LABEL}`);
    expect(lines).toContain(`--- a/${LABEL}`);
    expect(lines).toContain(`+++ b/${LABEL}`);
    expect(result.success).not.toContain(repoDir);
    expect(result.success).not.toContain("before.md");
    expect(result.success).not.toContain("after.md");
    expect(lines).toContain("-old");
    expect(lines).toContain("+new");

    const hunk = await diff(join(repoDir, "removed.md"), join(repoDir, "empty.md"));
    expect(Result.isSuccess(hunk)).toBe(true);
    if (Result.isFailure(hunk)) return;
    expect(hunk.success.split("\n")).toContain("--- gone");
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

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(result.success).not.toContain("EXTERNAL");
    expect(result.success).not.toContain("OLD");
    expect(result.success).not.toContain("\u001b[");
    expect(result.success.split("\n")).toEqual(expect.arrayContaining(["-old", "+new"]));
  });

  it("returns an empty diff for identical files", async () => {
    const before = join(repoDir, "before.md");
    const after = join(repoDir, "after.md");
    writeFileSync(before, "same\n");
    writeFileSync(after, "same\n");

    expect(await diff(before, after)).toEqual(Result.succeed(""));
  });

  it("fails on a missing file", async () => {
    const before = join(repoDir, "before.md");
    writeFileSync(before, "only one\n");

    const result = await diff(before, join(repoDir, "missing.md"));

    expect(Result.isFailure(result)).toBe(true);
  });
});
