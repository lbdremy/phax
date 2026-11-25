import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeBranchName, decodeWorktreePath } from "../../src/domain/branded.js";
import { NodeGitLayer, makeNodeGitLayer } from "../../src/infra/git.js";
import { Git, GitError, type GitOps } from "../../src/ports/git.js";
import { GIT_BOUND_MS, boundedOutput, boundedSpawn } from "../helpers/boundedSpawn.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The rooted git adapter against real git: every call in a phase worktree runs
// with no hook and no fsmonitor, after its .git pointer is checked; calls in
// the main checkout run the user's hooks as before. Each hook or fsmonitor that
// must not run creates a marker file, and the test reads the marker.

let root: string;
let repo: string;
let state: string;
let markers: string;
let restoreGit: () => void;

const gitIn = (cwd: string, ...args: string[]): string =>
  boundedOutput("git", args, { boundMs: GIT_BOUND_MS, cwd });

const writeIn = (dir: string, path: string, content: string, executable = false): void => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
  if (executable) chmodSync(join(dir, path), 0o755);
};

/** A shell script that creates `marker` under the markers directory. */
const markerScript = (marker: string): string =>
  `#!/bin/sh\ntouch "${join(markers, marker)}"\nexit 0\n`;

const marked = (marker: string): boolean => existsSync(join(markers, marker));

const rooted = () => makeNodeGitLayer({ repoRoot: repo });

function withGit<A>(
  layer: ReturnType<typeof rooted>,
  f: (ops: GitOps) => Effect.Effect<A, GitError>,
): Promise<Result.Result<A, GitError>> {
  return Effect.runPromise(Effect.result(Effect.flatMap(Git, f)).pipe(Effect.provide(layer)));
}

async function ok<A>(
  layer: ReturnType<typeof rooted>,
  f: (ops: GitOps) => Effect.Effect<A, GitError>,
): Promise<A> {
  const result = await withGit(layer, f);
  if (Result.isFailure(result)) throw new Error(result.failure.message);
  return result.success;
}

/** A phase branch and its worktree, created through the given layer. */
async function phaseWorktree(layer: ReturnType<typeof rooted>, name: string): Promise<string> {
  gitIn(repo, "branch", name, "main");
  const path = join(state, name);
  await ok(layer, (git) => git.addWorktree(branchOf(name), worktreePathOf(path), repo));
  return path;
}

const branchOf = (name: string) => Result.getOrThrow(decodeBranchName(name));
const worktreePathOf = (path: string) => Result.getOrThrow(decodeWorktreePath(path));

const head = (cwd: string): string => gitIn(cwd, "rev-parse", "HEAD").trim();

beforeEach(() => {
  restoreGit = isolateGit();
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-git-hardening-")));
  repo = join(root, "repo");
  state = join(root, "state");
  markers = join(root, "markers");
  mkdirSync(repo);
  mkdirSync(state);
  mkdirSync(markers);
  gitIn(repo, "init", "--initial-branch=main");
  disableGitAutoMaintenance(repo);
  gitIn(repo, "config", "--local", "user.email", "ada@example.test");
  gitIn(repo, "config", "--local", "user.name", "Ada Example");
  gitIn(repo, "config", "--local", "commit.gpgsign", "false");
  // husky's layout: the hooks are tracked files under .husky.
  gitIn(repo, "config", "--local", "core.hooksPath", ".husky");
  writeIn(repo, ".gitignore", ".phax-context/\n");
  writeIn(repo, ".husky/pre-commit", "#!/bin/sh\nexit 0\n", true);
  writeIn(repo, "src/app.ts", "export const a = 1;\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-m", "base");
});

afterEach(() => {
  removeTempDir(root);
  restoreGit();
});

describe("a husky pre-commit the agent rewrote", () => {
  it("runs neither at the phase commit nor at the stop close's commit, and both commits land", async () => {
    const layer = rooted();
    const wt = await phaseWorktree(layer, "phase-01");
    writeIn(wt, ".husky/pre-commit", markerScript("pre-commit"), true);

    writeIn(wt, "src/app.ts", "export const a = 2;\n");
    const before = head(wt);
    await ok(layer, (git) => git.commit(wt, "phase commit", "body"));
    expect(head(wt)).not.toBe(before);
    expect(marked("pre-commit")).toBe(false);

    writeIn(wt, "src/app.ts", "export const a = 3;\n");
    const beforeClose = head(wt);
    const tree = await ok(layer, (git) => git.snapshotWorktree(wt));
    const closed = await ok(layer, (git) => git.commitTree(wt, tree, "close commit", "body"));
    expect(head(wt)).toBe(closed);
    expect(closed).not.toBe(beforeClose);
    expect(marked("pre-commit")).toBe(false);

    // The rewritten hook is live: a plain git commit there runs it.
    writeIn(wt, "src/app.ts", "export const a = 4;\n");
    gitIn(wt, "commit", "-am", "plain");
    expect(marked("pre-commit")).toBe(true);
  });
});

describe("a post-checkout hook tracked under core.hooksPath", () => {
  beforeEach(() => {
    writeIn(repo, ".husky/post-checkout", markerScript("post-checkout"), true);
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-m", "post-checkout hook");
  });

  it.each([
    ["the rooted layer", () => rooted()],
    ["the repository-less layer", () => NodeGitLayer],
  ])("does not run when %s creates a phase worktree", async (_name, layer) => {
    const wt = await phaseWorktree(layer(), "phase-01");
    expect(existsSync(join(wt, "src/app.ts"))).toBe(true);
    expect(marked("post-checkout")).toBe(false);

    // The hook is live: a plain `git worktree add` runs it.
    gitIn(repo, "branch", "plain", "main");
    gitIn(repo, "worktree", "add", join(state, "plain"), "plain");
    expect(marked("post-checkout")).toBe(true);
  });
});

describe("a .git rewritten to another gitdir with a planted fsmonitor", () => {
  it("is refused before git runs, naming .git, its content and the expected gitdir", async () => {
    const layer = rooted();
    const wt = await phaseWorktree(layer, "phase-01");
    const base = head(wt);
    const expected = join(realpathSync(join(repo, ".git")), "worktrees", "phase-01");
    expect(readFileSync(join(wt, ".git"), "utf8").trim()).toBe(`gitdir: ${expected}`);

    const fsmonitor = join(root, "fsmonitor.sh");
    writeIn(root, "fsmonitor.sh", markerScript("fsmonitor"), true);
    writeIn(wt, "x/HEAD", `${base}\n`);
    writeIn(wt, "x/config", `[core]\n\trepositoryformatversion = 0\n\tfsmonitor = ${fsmonitor}\n`);
    mkdirSync(join(wt, "x/objects"), { recursive: true });
    mkdirSync(join(wt, "x/refs"), { recursive: true });
    writeIn(wt, ".git", "gitdir: ./x\n");

    const result = await withGit(layer, (git) => git.observeWorktree(wt, base, () => false));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(GitError);
      expect(result.failure.message).toBe(
        [
          `${join(wt, ".git")}: the worktree's .git no longer points at the git directory phax created`,
          ".git holds:  gitdir: ./x",
          `expected:    gitdir: ${expected}`,
          "phax ran no git command in this worktree after the change.",
        ].join("\n"),
      );
    }
    // Every other call there is refused too.
    expect(
      Result.isFailure(await withGit(layer, (git) => git.worktreeIsClean(worktreePathOf(wt)))),
    ).toBe(true);
    expect(marked("fsmonitor")).toBe(false);
  });

  it("refuses a .git replaced by a directory", async () => {
    const layer = rooted();
    const wt = await phaseWorktree(layer, "phase-01");
    gitIn(wt, "status");
    removeTempDir(join(wt, ".git"));
    mkdirSync(join(wt, ".git"));
    const result = await withGit(layer, (git) => git.headTree(wt));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result))
      expect(result.failure.message).toContain(".git holds:  a directory");
  });
});

describe("a core.fsmonitor written into the common .git/config", () => {
  it("does not run at phax's next worktree call, which succeeds", async () => {
    const layer = rooted();
    const wt = await phaseWorktree(layer, "phase-01");
    const base = head(wt);
    writeIn(wt, "src/app.ts", "export const a = 2;\n");
    writeIn(root, "fsmonitor.sh", markerScript("fsmonitor"), true);
    gitIn(repo, "config", "--local", "core.fsmonitor", join(root, "fsmonitor.sh"));

    const observation = await ok(layer, (git) => git.observeWorktree(wt, base, () => false));
    expect(observation.entries).toEqual([{ status: "modified", path: "src/app.ts" }]);
    expect(await ok(layer, (git) => git.worktreeIsClean(worktreePathOf(wt)))).toBe(false);
    expect(marked("fsmonitor")).toBe(false);

    // The planted fsmonitor is live: a plain git status there runs it.
    boundedSpawn("git", ["status"], { boundMs: GIT_BOUND_MS, cwd: wt });
    expect(marked("fsmonitor")).toBe(true);
  });
});

describe("the phase commit's patch and a stop commit's message", () => {
  it("run no diff.external, no textconv driver and no fsmonitor from the common config", async () => {
    const layer = rooted();
    const wt = await phaseWorktree(layer, "phase-01");
    writeIn(root, "external.sh", markerScript("diff-external"), true);
    writeIn(root, "textconv.sh", markerScript("textconv"), true);
    writeIn(root, "fsmonitor.sh", markerScript("fsmonitor"), true);
    gitIn(repo, "config", "--local", "diff.external", join(root, "external.sh"));
    gitIn(repo, "config", "--local", "diff.planted.textconv", join(root, "textconv.sh"));
    gitIn(repo, "config", "--local", "core.fsmonitor", join(root, "fsmonitor.sh"));
    writeIn(wt, ".gitattributes", "*.ts diff=planted\n");
    writeIn(wt, "src/app.ts", "export const a = 2;\n");
    await ok(layer, (git) => git.commit(wt, "feat: phase one", "Run-Id: run-1"));
    const commit = await ok(layer, (git) => git.headCommit(wt));

    const patch = await ok(layer, (git) => git.commitPatch(wt, commit));
    const message = await ok(layer, (git) => git.commitMessage(wt, commit));

    expect(patch).toContain("+export const a = 2;");
    expect(message).toBe("feat: phase one\n\nRun-Id: run-1\n\n");
    expect(marked("diff-external")).toBe(false);
    expect(marked("textconv")).toBe(false);
    expect(marked("fsmonitor")).toBe(false);

    // The planted diff.external is live: a plain git diff there runs it.
    boundedSpawn("git", ["diff", `${commit}^`, commit], { boundMs: GIT_BOUND_MS, cwd: wt });
    expect(marked("diff-external")).toBe(true);
  });
});

describe("an intact worktree", () => {
  it("answers status, snapshot and commit as before", async () => {
    const layer = rooted();
    const wt = await phaseWorktree(layer, "phase-01");
    expect(await ok(layer, (git) => git.worktreeIsClean(worktreePathOf(wt)))).toBe(true);
    const headTree = await ok(layer, (git) => git.headTree(wt));
    expect(await ok(layer, (git) => git.snapshotWorktree(wt))).toBe(headTree);

    writeIn(wt, "src/new.ts", "export const n = 1;\n");
    expect(await ok(layer, (git) => git.isClean(wt))).toBe(false);
    const snapshot = await ok(layer, (git) => git.snapshotWorktree(wt));
    expect(await ok(layer, (git) => git.changedPathsBetween(wt, headTree, snapshot))).toEqual([
      { status: "A", path: "src/new.ts" },
    ]);
    const before = head(wt);
    await ok(layer, (git) => git.commit(wt, "add new", "body"));
    expect(head(wt)).not.toBe(before);
    expect(gitIn(wt, "log", "-1", "--format=%s").trim()).toBe("add new");
    expect(await ok(layer, (git) => git.worktreeIsClean(worktreePathOf(wt)))).toBe(true);
  });

  it("is found again after a worktree is removed and recreated under a new registration", async () => {
    const layer = rooted();
    const wt = await phaseWorktree(layer, "phase-01");
    await ok(layer, (git) => git.removeWorktree(worktreePathOf(wt), true, repo));
    gitIn(repo, "branch", "phase-01b", "main");
    await ok(layer, (git) => git.addWorktree(branchOf("phase-01b"), worktreePathOf(wt), repo));
    expect(await ok(layer, (git) => git.worktreeIsClean(worktreePathOf(wt)))).toBe(true);
  });
});

describe("a git call in the main checkout", () => {
  it("still runs the user's own pre-commit", async () => {
    const layer = rooted();
    // A worktree exists, so the guard has registrations to tell apart.
    await phaseWorktree(layer, "phase-01");
    writeIn(repo, ".husky/pre-commit", markerScript("main-pre-commit"), true);
    writeIn(repo, "docs/note.md", "note\n");
    await ok(layer, (git) => git.commitPaths(repo, ["docs/note.md"], "note", "body"));
    expect(gitIn(repo, "log", "-1", "--format=%s").trim()).toBe("note");
    expect(marked("main-pre-commit")).toBe(true);
  });
});
