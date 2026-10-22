import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

let repo: string;

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();

// The real index, as `git ls-files --stage` lists it, and what `git diff
// --cached` stages: both must be the same after a snapshot or a restore.
const realIndex = (): string => `${git("ls-files", "--stage")}\n${git("diff", "--cached")}`;

const write = (path: string, content: string): void => {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), content);
};

const read = (path: string): string => readFileSync(join(repo, path), "utf8");

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "phax-git-snapshot-test-")));
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repo);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  write(".gitignore", ".phax-context/\n*.log\nbuild/\n");
  write("src/invoiceRow.ts", "export const columns = ['invoice_no'];\n");
  write("src/creditNote.ts", "export const credit = 1;\n");
  write("README.md", "# invoice export\n");
  git("add", "-A");
  // A tracked file that matches an ignore pattern.
  write("fixtures/seed.log", "tracked though ignored\n");
  git("add", "-f", "fixtures/seed.log");
  git("commit", "-m", "base");
});

afterEach(() => {
  removeTempDir(repo);
});

describe("NodeGitLayer.headTree and snapshotWorktree", () => {
  it("answers HEAD's tree for an unchanged worktree, a tracked ignored file included", async () => {
    const head = await withGit((g) => g.headTree(repo));
    expect(head).toBe(git("rev-parse", "HEAD^{tree}").trim());
    expect(await withGit((g) => g.snapshotWorktree(repo))).toBe(head);
  });

  it("leaves .phax-context/ and untracked ignored files out", async () => {
    const head = await withGit((g) => g.headTree(repo));
    write(".phax-context/interactive-review.md", "seed\n");
    write(".phax-context/correction-handoff.md", "handoff\n");
    write("debug.log", "noise\n");
    write("build/out.js", "compiled\n");
    expect(await withGit((g) => g.snapshotWorktree(repo))).toBe(head);
  });

  it("changes the tree for a modified, an added and a deleted file", async () => {
    const head = await withGit((g) => g.headTree(repo));

    write("src/invoiceRow.ts", "export const columns = ['Invoice number'];\n");
    const modified = await withGit((g) => g.snapshotWorktree(repo));
    expect(modified).not.toBe(head);
    git("checkout", "--", "src/invoiceRow.ts");

    write("src/added.ts", "export {};\n");
    const added = await withGit((g) => g.snapshotWorktree(repo));
    expect(added).not.toBe(head);
    rmSync(join(repo, "src/added.ts"));

    rmSync(join(repo, "src/creditNote.ts"));
    const deleted = await withGit((g) => g.snapshotWorktree(repo));
    expect(deleted).not.toBe(head);
  });

  it("sees an edit to a tracked file that matches an ignore pattern", async () => {
    const head = await withGit((g) => g.headTree(repo));
    write("fixtures/seed.log", "edited\n");
    expect(await withGit((g) => g.snapshotWorktree(repo))).not.toBe(head);
  });

  it("never touches the real index", async () => {
    write("src/invoiceRow.ts", "staged change\n");
    git("add", "src/invoiceRow.ts");
    write("src/invoiceRow.ts", "unstaged on top\n");
    write("src/new.ts", "untracked\n");
    const before = realIndex();
    await withGit((g) => g.snapshotWorktree(repo));
    expect(realIndex()).toBe(before);
    expect(git("status", "--porcelain")).toContain("?? src/new.ts");
  });
});

describe("NodeGitLayer.changedPathsBetween", () => {
  it("lists modified, added and deleted paths with no rename detection", async () => {
    const head = await withGit((g) => g.headTree(repo));
    write("src/invoiceRow.ts", "export const columns = ['Invoice number'];\n");
    // A move: with renames on it would read as one R entry.
    write("src/creditNotes.ts", read("src/creditNote.ts"));
    rmSync(join(repo, "src/creditNote.ts"));
    write("docs/a file with spaces.md", "spaces\n");
    const after = await withGit((g) => g.snapshotWorktree(repo));

    const changes = await withGit((g) => g.changedPathsBetween(repo, head, after));
    expect([...changes].toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { status: "A", path: "docs/a file with spaces.md" },
      { status: "D", path: "src/creditNote.ts" },
      { status: "A", path: "src/creditNotes.ts" },
      { status: "M", path: "src/invoiceRow.ts" },
    ]);
  });

  it("lists nothing between a tree and itself", async () => {
    const head = await withGit((g) => g.headTree(repo));
    expect(await withGit((g) => g.changedPathsBetween(repo, head, head))).toEqual([]);
  });
});

describe("NodeGitLayer.restorePaths", () => {
  it("brings the listed paths back and leaves every other path alone", async () => {
    const before = await withGit((g) => g.snapshotWorktree(repo));
    write(".phax-context/interactive-review.md", "seed\n");
    write("debug.log", "ignored, untouched\n");

    // The turn's edits.
    write("src/invoiceRow.ts", "turn edit\n");
    rmSync(join(repo, "src/creditNote.ts"));
    write("src/nested/dir/added.ts", "turn added\n");
    // The person's edit, which is not in the list.
    write("README.md", "# person's edit\n");

    await withGit((g) =>
      g.restorePaths(repo, before, [
        "src/invoiceRow.ts",
        "src/creditNote.ts",
        "src/nested/dir/added.ts",
      ]),
    );

    expect(read("src/invoiceRow.ts")).toBe("export const columns = ['invoice_no'];\n");
    expect(read("src/creditNote.ts")).toBe("export const credit = 1;\n");
    expect(existsSync(join(repo, "src/nested/dir/added.ts"))).toBe(false);
    expect(existsSync(join(repo, "src/nested"))).toBe(false);
    expect(read("README.md")).toBe("# person's edit\n");
    expect(read("debug.log")).toBe("ignored, untouched\n");
    expect(read(".phax-context/interactive-review.md")).toBe("seed\n");
  });

  it("never touches .phax-context/, even when a path there is listed", async () => {
    const before = await withGit((g) => g.snapshotWorktree(repo));
    write(".phax-context/correction-handoff.md", "the person's\n");
    await withGit((g) => g.restorePaths(repo, before, [".phax-context/correction-handoff.md"]));
    expect(read(".phax-context/correction-handoff.md")).toBe("the person's\n");
  });

  it("never touches the real index", async () => {
    const before = await withGit((g) => g.snapshotWorktree(repo));
    write("src/creditNote.ts", "staged by the person\n");
    git("add", "src/creditNote.ts");
    write("src/invoiceRow.ts", "turn edit\n");
    const index = realIndex();
    await withGit((g) => g.restorePaths(repo, before, ["src/invoiceRow.ts"]));
    expect(realIndex()).toBe(index);
    expect(read("src/creditNote.ts")).toBe("staged by the person\n");
  });

  it("restores the tree it is given, ignored tracked files included", async () => {
    const before = await withGit((g) => g.snapshotWorktree(repo));
    write("fixtures/seed.log", "turn edit\n");
    await withGit((g) => g.restorePaths(repo, before, ["fixtures/seed.log"]));
    expect(read("fixtures/seed.log")).toBe("tracked though ignored\n");
    expect(await withGit((g) => g.snapshotWorktree(repo))).toBe(before);
  });
});
