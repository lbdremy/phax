import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRunFindings } from "../../src/app/findingList.js";
import { loadConfig } from "../../src/app/loadConfig.js";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git } from "../../src/ports/git.js";
import type { FindingLanded } from "../../src/schemas/findingList.js";
import { findingListJson } from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce } from "../fixtures/findings/findingRunRepo.js";
import {
  BEFORE_RUN_START,
  buildRewriteRunRepo,
  commitOnMain,
  deleteRunBranch,
  dropUnreachable,
  fixByHandInWorktree,
  fixInWorktree,
  holds,
  messageOf,
  mergeRunBranch,
  rebaseAndMerge,
  rebaseRunBranch,
  refs,
  type RewriteRunRepo,
  squashMerge,
} from "../fixtures/findings/rewriteRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding list` resolves where each fixed finding's latest fix landed (spec
// finding-fix-identity §5.3 to §5.11, §8), over a temporary repository holding one run in
// review_open (tests/fixtures/findings/rewriteRunRepo.ts) whose history git rewrites the way a
// review and a merge do.

const INDENT = " ".repeat(13);

describe("phax finding list: where a fix landed", () => {
  let repo: RewriteRunRepo;
  let origCwd: string;

  beforeEach(() => {
    repo = buildRewriteRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const listed = async () => {
    const { result, document } = await findingListJson(repo);
    const landed = (id: string): FindingLanded | null => {
      const finding = document.findings.find((f) => f.id === id);
      if (finding === undefined) throw new Error(`${id} is not listed`);
      return finding.landed;
    };
    return { result, document, landed };
  };
  const listText = () => runnerCall([findingGroup], ["finding", "list", repo.shortName]);

  // ac-direct
  it("finds a fix merged with a merge commit by its recorded sha on main, and adds nothing to its line", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const fix = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    mergeRunBranch(repo);

    const { document, landed } = await listed();
    expect(document.run.baseBranch).toBe("main");
    expect(landed("F1")).toEqual({
      status: "found",
      by: "recorded",
      commit: fix,
      branch: "main",
      recorded: fix,
    });
    const text = await listText();
    expect(text.code).toBe(0);
    expect(text.outLines).toContain(`${INDENT}${fix.slice(0, 7)} (code)`);
    expect(text.out).not.toContain("→");
  });

  // ac-rebase-merge
  it("finds a fix recreated by Rebase and merge, its branch deleted, by key on main", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const fix = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const main = rebaseAndMerge(repo);
    expect(main).not.toBe(fix);

    const { landed } = await listed();
    expect(landed("F1")).toEqual({
      status: "found",
      by: "key",
      commit: main,
      branch: "main",
      recorded: fix,
    });
    const text = await listText();
    expect(text.outLines).toContain(
      `${INDENT}${fix.slice(0, 7)} (code) → ${main.slice(0, 7)} on main, by key`,
    );
  });

  // ac-squash-messages
  it("resolves two fixes squashed into one commit that keeps their messages, each by key", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const fixA = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const fixB = await fixInWorktree(repo, ["F2"], "src/app/fix-two.ts", "export const two = 2;\n");
    const squash = squashMerge(repo, "messages");
    deleteRunBranch(repo);
    expect(messageOf(repo, squash)).toContain(`Finding-Run: ${repo.runId}\nFinding: F1`);

    const { document, landed } = await listed();
    expect(landed("F1")).toEqual({
      status: "found",
      by: "key",
      commit: squash,
      branch: "main",
      recorded: fixA,
    });
    expect(landed("F2")).toEqual({
      status: "found",
      by: "key",
      commit: squash,
      branch: "main",
      recorded: fixB,
    });
    const history = (id: string) =>
      document.findings
        .find((f) => f.id === id)
        ?.history.map((entry) => entry.fate === "fixed" && entry.commit);
    expect(history("F1")).toEqual([fixA]);
    expect(history("F2")).toEqual([fixB]);
  });

  // ac-patch-id
  it("finds a trailer-less fix rebased onto main by its patch id while the old commit is held", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const fix = await fixByHandInWorktree(
      repo,
      ["F1"],
      "src/app/hand.ts",
      "export const hand = 1;\n",
    );
    const main = rebaseAndMerge(repo);
    expect(holds(repo, fix)).toBe(true);

    const { landed } = await listed();
    expect(landed("F1")).toEqual({
      status: "found",
      by: "patch-id",
      commit: main,
      branch: "main",
      recorded: fix,
    });
    const text = await listText();
    expect(text.outLines).toContain(
      `${INDENT}${fix.slice(0, 7)} (code) → ${main.slice(0, 7)} on main, by patch id`,
    );
  });

  // ac-patch-id-range
  it("never reports a main commit with the same patch id made before the run started", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const content = "export const same = 1;\n";
    const fix = await fixByHandInWorktree(repo, ["F1"], "src/app/same.ts", content);
    commitOnMain(repo, {
      path: "src/app/same.ts",
      content,
      message: "feat: the same change, long before",
      date: BEFORE_RUN_START,
    });
    deleteRunBranch(repo);
    expect(holds(repo, fix)).toBe(true);

    const { landed } = await listed();
    expect(landed("F1")).toEqual({
      status: "not-found",
      branches: ["main", repo.runBranch],
      recorded: fix,
    });
  });

  // ac-run-branch
  it("finds a fix on the run's branch, rebased onto main and not merged, by key", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const fix = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const tip = rebaseRunBranch(repo);

    const { landed } = await listed();
    expect(landed("F1")).toEqual({
      status: "found",
      by: "key",
      commit: tip,
      branch: repo.runBranch,
      recorded: fix,
    });
    const text = await listText();
    expect(text.outLines).toContain(
      `${INDENT}${fix.slice(0, 7)} (code) → ${tip.slice(0, 7)} on ${repo.runBranch}, by key`,
    );
  });

  // ac-ambiguous
  it("answers ambiguous, oldest first and with no commit, when two main commits carry the key", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const fix = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const trailers = `Short-Name: ${repo.shortName}\nFinding-Run: ${repo.runId}\nFinding: F1`;
    const first = commitOnMain(repo, {
      path: "src/app/pick-one.ts",
      content: "export const pick = 1;\n",
      message: `fix(review): F1, picked\n\n${trailers}`,
    });
    const second = commitOnMain(repo, {
      path: "src/app/pick-two.ts",
      content: "export const pick = 2;\n",
      message: `fix(review): F1, picked again\n\n${trailers}`,
    });

    const { landed } = await listed();
    expect(landed("F1")).toEqual({
      status: "ambiguous",
      commits: [first, second],
      branch: "main",
      recorded: fix,
    });
    const text = await listText();
    expect(text.outLines).toContain(
      `${INDENT}${fix.slice(0, 7)} (code) → ambiguous on main: ${first.slice(0, 7)}, ${second.slice(0, 7)}`,
    );
  });

  // ac-not-found
  it("keeps a fix squashed with a description only fixed, and says where it was not found", async () => {
    await reviewOnce(repo, ["one", "two"]);
    const fix = await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    squashMerge(repo, "description");
    deleteRunBranch(repo);
    dropUnreachable(repo);
    expect(holds(repo, fix)).toBe(false);

    const { document, landed } = await listed();
    expect(document.findings.find((f) => f.id === "F1")?.fate).toBe("fixed");
    expect(landed("F1")).toEqual({
      status: "not-found",
      branches: ["main", repo.runBranch],
      recorded: fix,
    });
    const text = await listText();
    expect(text.code).toBe(0);
    expect(text.outLines).toContain(
      `${INDENT}${fix.slice(0, 7)} (code) → not found on main or ${repo.runBranch}`,
    );
  });

  // ac-null
  it("gives open, dismissed and deferred findings a null landed", async () => {
    await reviewOnce(repo, ["one", "two", "three", "four"]);
    await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    const dismiss = await runnerCall(
      [findingGroup],
      ["finding", "dismiss", repo.shortName, "F2", "--why", "Not worth it.", "--by", "operator"],
    );
    expect(dismiss.code).toBe(0);
    const defer = await runnerCall(
      [findingGroup],
      [
        "finding",
        "defer",
        repo.shortName,
        "F3",
        "--to",
        "docs/briefs/gate-retry-docs.md",
        "--why",
        "Later.",
        "--by",
        "operator",
      ],
    );
    expect(defer.code).toBe(0);

    const { document } = await listed();
    expect(document.findings.map((f) => [f.id, f.fate, f.landed === null])).toEqual([
      ["F1", "fixed", false],
      ["F2", "dismissed", true],
      ["F3", "deferred", true],
      ["F4", "open", true],
    ]);
  });

  // ac-read-only
  it("writes, fetches and pushes nothing while it resolves a fix by key", async () => {
    await reviewOnce(repo, ["one", "two"]);
    await fixInWorktree(repo, ["F1"], "src/app/fix-one.ts", "export const one = 1;\n");
    rebaseAndMerge(repo);
    const config = loadConfig(repo.repoDir);
    if (Result.isFailure(config)) throw new Error(config.failure.message);

    const writes: string[] = [];
    const refused = (name: string) => () => {
      writes.push(name);
      return Effect.die(new Error(`${name} called by a read`));
    };
    const ReadOnlyGitLayer = Layer.effect(
      Git,
      Effect.gen(function* () {
        const git = yield* Git;
        return {
          ...git,
          fetchBranch: refused("fetchBranch"),
          fetchRemote: refused("fetchRemote"),
          pushBranch: refused("pushBranch"),
          writeTreeCommit: refused("writeTreeCommit"),
          updateRef: refused("updateRef"),
          commit: refused("commit"),
          commitPaths: refused("commitPaths"),
          commitTree: refused("commitTree"),
        };
      }),
    ).pipe(Layer.provide(NodeGitLayer));

    const refsBefore = refs(repo);
    const folderBefore = folderBytes(repo.runFolder);
    const answer = await Effect.runPromise(
      listRunFindings({ ref: repo.shortName, config: config.success }).pipe(
        Effect.provide(Layer.mergeAll(NodeFileSystemLayer, ReadOnlyGitLayer)),
      ),
    );

    expect(answer.document.findings.find((f) => f.id === "F1")?.landed?.status).toBe("found");
    expect(writes).toEqual([]);
    expect(refs(repo)).toBe(refsBefore);
    expect(folderBytes(repo.runFolder)).toEqual(folderBefore);
  });
});

/** Every file under `root`, by its path, with its bytes as text. */
function folderBytes(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).toSorted()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[path.slice(root.length + 1)] = readFileSync(path, "base64");
    }
  };
  walk(root);
  return files;
}
