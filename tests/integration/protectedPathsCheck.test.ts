import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { checkProtectedPaths } from "../../src/app/protectedPathsCheck.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import type { BranchName } from "../../src/domain/branded.js";
import { Git } from "../../src/ports/git.js";
import { protectedList, type ProtectedChange } from "../../src/domain/security/protectedPaths.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

let repo: string;
let base: string;
let restoreGit: () => void;

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();

const write = (path: string, content: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};

// A symbolic link at `path` to `target`, another file of the repository. The
// target is absolute: the home guard resolves a relative one against the cwd.
const link = (target: string, path: string): void =>
  symlinkSync(join(repo, target), join(repo, path));

const commitAll = (message: string): string => {
  git("add", "-A");
  git("commit", "-m", message);
  return git("rev-parse", "HEAD").trim();
};

const check = (globs: readonly string[], from = base): Promise<readonly ProtectedChange[]> =>
  Effect.runPromise(
    checkProtectedPaths({
      worktree: repo,
      base: from,
      list: protectedList(globs, "phax.json")!,
    }).pipe(Effect.provide(NodeGitLayer)),
  );

// The change list as `[path, kind]` pairs, which is what the cases compare.
const brief = (changes: readonly ProtectedChange[]): readonly (readonly [string, string])[] =>
  changes.map((c) => [c.path, c.kind] as const);

beforeEach(() => {
  restoreGit = isolateGit();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "phax-protected-check-test-")));
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repo);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  write(".gitignore", ".phax-context/\ngenerated/\n");
  write("phax.json", "{}\n");
  write("packages/a/steme.baseline.json", '{ "package": "a" }\n');
  write("packages/b/steme.baseline.json", '{ "package": "b", "rules": 2 }\n');
  write("packages/c/steme.baseline.json", '{ "package": "c", "rules": 3, "extra": true }\n');
  write("packages/d/x.json", '{ "package": "d", "rules": 4, "unrelated": [1, 2, 3] }\n');
  write("src/app.ts", "export const app = 1;\n");
  base = commitAll("base");
});

afterEach(() => {
  removeTempDir(repo);
  restoreGit();
});

describe("checkProtectedPaths against a real worktree", () => {
  it("names a created, a deleted and two renamed protected files", async () => {
    write("packages/e/steme.baseline.json", '{ "package": "e" }\n');
    unlinkSync(join(repo, "packages/b/steme.baseline.json"));
    git("mv", "packages/c/steme.baseline.json", "packages/c/old.json");
    git("mv", "packages/d/x.json", "packages/d/steme.baseline.json");

    expect(brief(await check(["**/steme.baseline.json"]))).toEqual([
      ["packages/b/steme.baseline.json", "deleted"],
      ["packages/c/steme.baseline.json", "renamed"],
      ["packages/d/steme.baseline.json", "renamed"],
      ["packages/e/steme.baseline.json", "created"],
    ]);
  });

  it("names the glob and the entry that matched", async () => {
    write("packages/e/steme.baseline.json", "{}\n");
    expect(await check(["src/**", "**/steme.baseline.json"])).toEqual([
      {
        path: "packages/e/steme.baseline.json",
        kind: "created",
        entry: "protectedPaths[1]",
        glob: "**/steme.baseline.json",
      },
    ]);
  });

  it("names a symbolic link that replaces a protected file and a case variant, spelt as written", async () => {
    unlinkSync(join(repo, "packages/a/steme.baseline.json"));
    link("packages/b/steme.baseline.json", "packages/a/steme.baseline.json");
    write("packages/b/RÈGLES.json", "{}\n");

    expect(brief(await check(["**/steme.baseline.json", "**/règles.json"]))).toEqual([
      ["packages/a/steme.baseline.json", "edited"],
      ["packages/b/RÈGLES.json", "created"],
    ]);
  });

  it("names a protected file replaced by a link with another target", async () => {
    unlinkSync(join(repo, "packages/a/steme.baseline.json"));
    link("packages/b/steme.baseline.json", "packages/a/steme.baseline.json");
    base = commitAll("link");
    unlinkSync(join(repo, "packages/a/steme.baseline.json"));
    link("packages/c/steme.baseline.json", "packages/a/steme.baseline.json");

    expect(brief(await check(["**/steme.baseline.json"]))).toEqual([
      ["packages/a/steme.baseline.json", "edited"],
    ]);
  });

  it("names a change of the executable bit", async () => {
    chmodSync(join(repo, "packages/a/steme.baseline.json"), 0o755);
    expect(brief(await check(["**/steme.baseline.json"]))).toEqual([
      ["packages/a/steme.baseline.json", "edited"],
    ]);
  });

  it.each(["--skip-worktree", "--assume-unchanged"])(
    "names an edit hidden by git update-index %s",
    async (flag) => {
      git("update-index", flag, "packages/a/steme.baseline.json");
      write("packages/a/steme.baseline.json", '{ "package": "edited" }\n');

      expect(git("diff")).toBe("");
      expect(brief(await check(["**/steme.baseline.json"]))).toEqual([
        ["packages/a/steme.baseline.json", "edited"],
      ]);
    },
  );

  it("names a protected file created under a gitignored folder", async () => {
    write("generated/allow.json", "{}\n");
    write("generated/other.json", "{}\n");
    expect(brief(await check(["**/allow.json"]))).toEqual([["generated/allow.json", "created"]]);
  });

  it("judges an edit the agent committed itself against the base, not HEAD", async () => {
    write("packages/a/steme.baseline.json", '{ "package": "a", "rules": 99 }\n');
    const head = commitAll("agent commit");
    expect(head).not.toBe(base);
    expect(git("status", "--porcelain")).toBe("");

    expect(brief(await check(["**/steme.baseline.json"]))).toEqual([
      ["packages/a/steme.baseline.json", "edited"],
    ]);
    expect(await check(["**/steme.baseline.json"], head)).toEqual([]);
  });

  it("names nothing for a clean worktree", async () => {
    write(".phax-context/summary.md", "notes\n");
    expect(await check(["**/steme.baseline.json"])).toEqual([]);
  });

  it("names the loaded phax.json by its path", async () => {
    write("phax.json", '{ "protectedPaths": [] }\n');
    expect(brief(await check(["**/steme.baseline.json"]))).toEqual([["phax.json", "edited"]]);
  });

  it("hashes the protected files by one git process and reads the base tree once", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `rules/r${i}/steme.baseline.json`);
    for (const path of many) write(path, `{ "rule": "${path}" }\n`);
    write("rules/odd\nname/steme.baseline.json", "{}\n");
    write('rules/"quoted\\name\r/steme.baseline.json', "{}\n");
    base = commitAll("many");
    write("rules/r7/steme.baseline.json", "{}\n");
    write("rules/odd\nname/steme.baseline.json", '{ "odd": true }\n');

    // A git on PATH that logs each call's argument count and subcommand, then
    // runs the real one.
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const shim = realpathSync(mkdtempSync(join(tmpdir(), "phax-git-shim-")));
    const log = join(shim, "calls.log");
    writeFileSync(
      join(shim, "git"),
      `#!/bin/sh\nprintf '%s %s\\n' "$#" "$1" >> '${log}'\nexec '${realGit}' "$@"\n`,
    );
    chmodSync(join(shim, "git"), 0o755);
    const path = process.env["PATH"];
    process.env["PATH"] = `${shim}:${path ?? ""}`;
    try {
      expect(brief(await check(["**/steme.baseline.json"]))).toEqual([
        ["rules/odd\nname/steme.baseline.json", "edited"],
        ["rules/r7/steme.baseline.json", "edited"],
      ]);
    } finally {
      process.env["PATH"] = path;
    }
    const calls = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [count, command] = line.split(" ");
        return { count: Number(count), command };
      });
    removeTempDir(shim);
    expect(calls.filter((call) => call.command === "hash-object")).toHaveLength(1);
    expect(calls.filter((call) => call.command === "ls-tree")).toHaveLength(1);
    // No call's arguments grow with the number of protected files.
    expect(Math.max(...calls.map((call) => call.count))).toBeLessThan(12);
  });

  it("leaves the real index alone", async () => {
    write("packages/a/steme.baseline.json", "{}\n");
    write("packages/e/steme.baseline.json", "{}\n");
    const before = `${git("ls-files", "--stage")}${git("status", "--porcelain")}`;
    await check(["**/steme.baseline.json"]);
    expect(`${git("ls-files", "--stage")}${git("status", "--porcelain")}`).toBe(before);
  });
});

describe("Git.observeWorktree", () => {
  const observe = (tracked: readonly string[]) =>
    Effect.runPromise(
      Effect.flatMap(Git, (g) => g.observeWorktree(repo, base, (p) => tracked.includes(p))).pipe(
        Effect.provide(NodeGitLayer),
      ),
    );

  it("reads a type change as type-changed and a rename with both of its paths", async () => {
    unlinkSync(join(repo, "packages/a/steme.baseline.json"));
    link("src/app.ts", "packages/a/steme.baseline.json");
    git("mv", "packages/c/steme.baseline.json", "packages/c/old.json");

    const observation = await observe(["packages/a/steme.baseline.json"]);
    expect(observation.entries).toEqual(
      expect.arrayContaining([
        { status: "type-changed", path: "packages/a/steme.baseline.json" },
        {
          status: "renamed",
          oldPath: "packages/c/steme.baseline.json",
          path: "packages/c/old.json",
        },
      ]),
    );
    expect(observation.entries).toHaveLength(2);
    expect(observation.tracked).toEqual([
      { path: "packages/a/steme.baseline.json", state: "type" },
    ]);
  });

  it("reports names holding a tab, a newline, a leading space and non-ASCII characters as written", async () => {
    write("conf/old.json", '{ "name": "old", "long": "enough to match as a rename" }\n');
    write("conf/star*.json", '{ "star": 1 }\n');
    base = commitAll("conf");
    git("mv", "conf/old.json", "conf/tab\there.json");
    write("conf/line\nbreak.json", "{}\n");
    write("conf/ lead.json", "{}\n");
    write("conf/héllo ✓.json", "{}\n");
    write("conf/star*.json", '{ "star": 2 }\n');

    const changes = await check(["conf/**"]);
    expect(brief(changes)).toEqual([
      ["conf/ lead.json", "created"],
      ["conf/héllo ✓.json", "created"],
      ["conf/line\nbreak.json", "created"],
      ["conf/old.json", "renamed"],
      ["conf/star*.json", "edited"],
      ["conf/tab\there.json", "renamed"],
    ]);
    const observation = await observe(["conf/old.json", "conf/star*.json"]);
    expect(observation.entries).toContainEqual({
      status: "renamed",
      oldPath: "conf/old.json",
      path: "conf/tab\there.json",
    });
  });

  it("asks git for nothing when no path is given", async () => {
    write("src/app.ts", "export const app = 2;\n");
    expect(await observe([])).toEqual({
      entries: [{ status: "modified", path: "src/app.ts" }],
      tracked: [],
      untracked: [],
    });
  });

  it("lists the untracked ignored files and leaves .phax-context out", async () => {
    write("generated/a.json", "{}\n");
    write(".phax-context/notes.md", "notes\n");
    expect((await observe([])).untracked).toEqual(["generated/a.json"]);
  });

  it("matches the fake's default observation for a clean worktree", async () => {
    const tracked = ["packages/a/steme.baseline.json", "packages/b/steme.baseline.json"];
    const fake = makeFakeGit();
    const scripted = await Effect.runPromise(
      Effect.gen(function* () {
        const g = yield* Git;
        const fakeBase = yield* g.writeTreeCommit({
          repo,
          branch: "base" as BranchName,
          message: "base",
          files: tracked.map((path) => ({ path, content: new TextEncoder().encode("{}\n") })),
        });
        return yield* g.observeWorktree(repo, fakeBase, (p) => tracked.includes(p));
      }).pipe(Effect.provide(fake.layer)),
    );
    expect(await observe(tracked)).toEqual(scripted);
  });
});
