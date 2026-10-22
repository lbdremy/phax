import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, GitError, type GitOps } from "../../src/ports/git.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// commitTree and diffTrees against a temporary repository whose git identity
// is the made-up Ada Example, with its own hooks directory.

const withGit = <A>(f: (ops: GitOps) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(Git, f).pipe(Effect.provide(NodeGitLayer)));

const withGitEither = <A>(f: (ops: GitOps) => Effect.Effect<A, unknown>) =>
  Effect.runPromise(Effect.either(Effect.flatMap(Git, f)).pipe(Effect.provide(NodeGitLayer)));

let repo: string;
let hooks: string;

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();

const write = (path: string, content: string): void => {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), content);
};

const read = (path: string): string => readFileSync(join(repo, path), "utf8");

const hook = (name: string, body: string): void => {
  writeFileSync(join(hooks, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(hooks, name), 0o755);
};

const realIndex = (): string => `${git("ls-files", "--stage")}\n${git("diff", "--cached")}`;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "phax-git-commit-tree-test-")));
  hooks = join(repo, ".hooks-under-test");
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repo);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  git("config", "--local", "commit.gpgsign", "false");
  mkdirSync(hooks);
  git("config", "--local", "core.hooksPath", hooks);
  write(".gitignore", ".phax-context/\n.hooks-under-test/\n");
  write("src/invoiceRow.ts", "export const header = 'invoice_no';\n");
  write("src/creditNote.ts", "export const credit = 1;\n");
  git("add", "-A");
  git("commit", "-m", "base");
});

afterEach(() => {
  removeTempDir(repo);
});

// The person's corrections, snapshotted: a modified, an added and a deleted file.
async function correctedTree(): Promise<string> {
  write("src/invoiceRow.ts", "export const header = 'Invoice number';\n");
  write("src/export/labels.ts", "export const labels = {};\n");
  git("rm", "-q", "src/creditNote.ts");
  return withGit((ops) => ops.snapshotWorktree(repo));
}

describe("NodeGitLayer.commitTree", () => {
  it("commits exactly the given tree on HEAD, as Ada Example, and moves the branch and the index", async () => {
    const before = git("rev-parse", "HEAD").trim();
    const tree = await correctedTree();
    // Something staged that is not in the tree: it must not reach the commit.
    write("scratch.txt", "not part of the correction\n");
    git("add", "scratch.txt");

    const sha = await withGit((ops) =>
      ops.commitTree(repo, tree, "feat(export): review", "Made-up body."),
    );

    expect(git("rev-parse", "HEAD").trim()).toBe(sha);
    expect(git("rev-parse", "refs/heads/main").trim()).toBe(sha);
    expect(git("rev-parse", `${sha}^{tree}`).trim()).toBe(tree);
    expect(git("rev-parse", `${sha}^`).trim()).toBe(before);
    expect(git("log", "-1", "--format=%an <%ae>|%s|%b", sha).trim()).toBe(
      "Ada Example <ada@example.test>|feat(export): review|Made-up body.",
    );
    // The real index is the new HEAD: the corrections read as committed, the
    // stray staged file as untracked.
    expect(git("diff", "--cached", "--name-only")).toBe("");
    expect(git("status", "--porcelain")).toBe("?? scratch.txt\n");
  });

  it("lands an empty commit when given HEAD's own tree", async () => {
    const before = git("rev-parse", "HEAD").trim();
    const headTree = git("rev-parse", "HEAD^{tree}").trim();

    const sha = await withGit((ops) =>
      ops.commitTree(repo, headTree, "review: no change", "Body."),
    );

    expect(sha).not.toBe(before);
    expect(git("rev-parse", `${sha}^{tree}`).trim()).toBe(headTree);
    expect(git("rev-parse", `${sha}^`).trim()).toBe(before);
  });

  it("runs the pre-commit and commit-msg hooks with the tree staged", async () => {
    hook("pre-commit", `git diff --cached --name-only > "${join(hooks, "staged.txt")}"`);
    hook("commit-msg", `cp "$1" "${join(hooks, "message.txt")}"`);
    const tree = await correctedTree();

    await withGit((ops) => ops.commitTree(repo, tree, "feat(export): review", "Body."));

    expect(readFileSync(join(hooks, "staged.txt"), "utf8").trim().split("\n")).toEqual([
      "src/creditNote.ts",
      "src/export/labels.ts",
      "src/invoiceRow.ts",
    ]);
    expect(readFileSync(join(hooks, "message.txt"), "utf8")).toContain("feat(export): review");
  });

  it("fails when the pre-commit hook rejects, leaving HEAD and the real index unchanged", async () => {
    hook("pre-commit", "echo 'lint failed' >&2\nexit 1");
    const tree = await correctedTree();
    const head = git("rev-parse", "HEAD").trim();
    const index = realIndex();

    const result = await withGitEither((ops) => ops.commitTree(repo, tree, "s", "b"));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result))
      expect(String((result.left as Error).message)).toContain("lint failed");
    expect(git("rev-parse", "HEAD").trim()).toBe(head);
    expect(realIndex()).toBe(index);
  });

  it("undoes a commit whose pre-commit hook rewrote and staged a file, naming it", async () => {
    hook("pre-commit", "echo '// formatted' >> src/invoiceRow.ts\ngit add src/invoiceRow.ts");
    const tree = await correctedTree();
    const head = git("rev-parse", "HEAD").trim();

    const result = await withGitEither((ops) => ops.commitTree(repo, tree, "s", "b"));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GitError);
      expect((result.left as GitError).message).toContain("src/invoiceRow.ts");
    }
    expect(git("rev-parse", "HEAD").trim()).toBe(head);
    expect(git("rev-parse", "refs/heads/main").trim()).toBe(head);
  });
});

describe("NodeGitLayer.diffTrees", () => {
  it("returns the content diff of a modified, an added and a deleted file", async () => {
    const head = git("rev-parse", "HEAD^{tree}").trim();
    const tree = await correctedTree();

    const diff = await withGit((ops) => ops.diffTrees(repo, head, tree));

    expect(diff).toContain("diff --git a/src/invoiceRow.ts b/src/invoiceRow.ts");
    expect(diff).toContain("-export const header = 'invoice_no';");
    expect(diff).toContain("+export const header = 'Invoice number';");
    expect(diff).toContain("diff --git a/src/export/labels.ts b/src/export/labels.ts");
    expect(diff).toContain("new file mode 100644");
    expect(diff).toContain("+export const labels = {};");
    expect(diff).toContain("diff --git a/src/creditNote.ts b/src/creditNote.ts");
    expect(diff).toContain("deleted file mode 100644");
    expect(diff).toContain("-export const credit = 1;");
    expect(read("src/invoiceRow.ts")).toBe("export const header = 'Invoice number';\n");
  });

  it("is empty between a tree and itself", async () => {
    const head = git("rev-parse", "HEAD^{tree}").trim();
    expect(await withGit((ops) => ops.diffTrees(repo, head, head))).toBe("");
  });
});
