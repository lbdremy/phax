import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import {
  findingListJson,
  head,
  lockRecordsBranch,
  writeInWorktree,
} from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce } from "../fixtures/findings/findingRunRepo.js";
import {
  buildPrRunRepo,
  ghCalls,
  ghComments,
  installFakeGh,
  type PrRunRepo,
  publishPr,
  remoteHead,
  setPublishAuto,
} from "../fixtures/findings/prRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";
import { removeTempDir } from "../helpers/tempGit.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// What the fate commands do, or do not do, to a run's pull request outside the happy path of
// findingPullRequest.test.ts: publish.auto off, a list that stays local, a remote that moved, a
// comment that fails and its retry, a record that fails, `--commit`, and publish.pushBranch off.

const RECORDS_BRANCH = "phax/records/v1";

describe("fate commands and the pull request, off the happy path", () => {
  let repo: PrRunRepo;
  let origCwd: string;
  let prUrl: string;
  const scratch: string[] = [];

  beforeEach(async () => {
    repo = buildPrRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
    setPublishAuto(repo, false);
    await reviewOnce(repo, ["one", "two", "three", "four", "five"]);
    const published = await publishPr(repo);
    expect(published.code).toBe(0);
    expect(published.prUrl).not.toBeNull();
    prUrl = published.prUrl as string;
  });

  afterEach(() => {
    process.chdir(origCwd);
    for (const dir of scratch.splice(0)) removeTempDir(dir);
    repo.cleanup();
  });

  const fix = (ids: readonly string[], path: string, ...extra: readonly string[]) =>
    runnerCall(
      [findingGroup],
      ["finding", "fix", repo.shortName, ...ids, "--by", "operator", ...extra, "--", path],
    );
  const dismiss = (id: string, ...extra: readonly string[]) =>
    runnerCall(
      [findingGroup],
      ["finding", "dismiss", repo.shortName, id, "--by", "operator", "--why", "x", ...extra],
    );
  const defer = (id: string, ...extra: readonly string[]) =>
    runnerCall(
      [findingGroup],
      [
        "finding",
        "defer",
        repo.shortName,
        id,
        "--by",
        "operator",
        "--to",
        "docs/briefs/gate-retry-docs.md",
        "--why",
        "later",
        ...extra,
      ],
    );
  const runBranchHead = () => head(repo, repo.runBranch) as string;
  const fates = async () => {
    const { document } = await findingListJson(repo);
    return Object.fromEntries(document.findings.map((finding) => [finding.id, finding.fate]));
  };
  /** The error object of a `--json` call that failed: the last line of what it printed. */
  const jsonError = (result: { readonly out: string; readonly err: string }) => {
    const text = result.err.trim() !== "" ? result.err : result.out;
    return JSON.parse(text.trim().split("\n").at(-1) as string) as Record<string, unknown>;
  };
  const pullRequestOf = (result: { readonly out: string }) =>
    (JSON.parse(result.out) as { pullRequest: Record<string, unknown> }).pullRequest;

  // AC-publish-auto-off
  it("makes no push and no gh call with publish.auto off, records the fates and answers not-posted", async () => {
    installFakeGh(repo, "fails");
    const remoteBefore = remoteHead(repo);

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const fixed = await fix(["F2"], "tests/gate.test.ts", "--json");
    const dismissed = await dismiss("F3", "--json");
    const deferred = await defer("F5", "--json");

    for (const result of [fixed, dismissed, deferred]) {
      expect(result.code).toBe(0);
      expect(pullRequestOf(result)).toEqual({ kind: "not-posted", reason: "publish-auto-off" });
    }
    expect(remoteHead(repo)).toBe(remoteBefore);
    expect(ghCalls(repo)).toEqual([]);
    expect(await fates()).toMatchObject({
      F1: "open",
      F2: "fixed",
      F3: "dismissed",
      F4: "open",
      F5: "deferred",
    });
  });

  // AC-list-local
  it("lists findings with no GitHub call while a pull request exists and publish.auto is on", async () => {
    setPublishAuto(repo, true);
    installFakeGh(repo, "answers");

    const text = await runnerCall([findingGroup], ["finding", "list", repo.shortName]);
    const json = await runnerCall([findingGroup], ["finding", "list", repo.shortName, "--json"]);

    expect(text.code).toBe(0);
    expect(json.code).toBe(0);
    expect(ghCalls(repo)).toEqual([]);
  });

  it("keeps the commit and the fate when the remote branch has moved, and posts nothing", async () => {
    setPublishAuto(repo, true);
    installFakeGh(repo, "answers");
    const clone = realpathSync(mkdtempSync(join(tmpdir(), "phax-pr-clone-")));
    scratch.push(clone);
    const sh = (args: readonly string[]) =>
      execFileSync("git", [...args], { cwd: clone, encoding: "utf8", stdio: "pipe" });
    sh(["clone", "-q", repo.remoteDir, "."]);
    sh(["checkout", "-q", repo.runBranch]);
    writeFileSync(join(clone, "elsewhere.txt"), "moved\n");
    sh(["add", "elsewhere.txt"]);
    sh([
      "-c",
      "user.name=Someone",
      "-c",
      "user.email=someone@example.com",
      "commit",
      "-q",
      "-m",
      "x",
    ]);
    sh(["push", "-q", "origin", `HEAD:refs/heads/${repo.runBranch}`]);
    const moved = remoteHead(repo);
    const before = runBranchHead();

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const result = await fix(["F2"], "tests/gate.test.ts", "--json");

    expect(result.code).toBe(1);
    const error = jsonError(result);
    expect(JSON.stringify(error)).toContain("FindingPullRequestNotUpdatedError");
    expect(JSON.stringify(error)).toContain("git pull --no-rebase");
    expect(JSON.stringify(error)).toContain(`phax finding post ${repo.shortName} F2`);
    expect(ghComments(repo)).toEqual([]);
    expect(remoteHead(repo)).toBe(moved);
    expect(runBranchHead()).not.toBe(before);
    expect(error).toMatchObject({
      error: "FindingPullRequestNotUpdatedError",
      exit: 1,
      fields: { commit: runBranchHead(), recorded: ["F2"], pushed: false, unposted: ["F2"] },
    });
    expect((await fates())["F2"]).toBe("fixed");
  });

  it("names git pull and the post retry on stderr in text mode when the remote branch has moved", async () => {
    setPublishAuto(repo, true);
    installFakeGh(repo, "answers");
    const clone = realpathSync(mkdtempSync(join(tmpdir(), "phax-pr-clone-")));
    scratch.push(clone);
    const sh = (args: readonly string[]) =>
      execFileSync("git", [...args], { cwd: clone, encoding: "utf8", stdio: "pipe" });
    sh(["clone", "-q", repo.remoteDir, "."]);
    sh(["checkout", "-q", repo.runBranch]);
    writeFileSync(join(clone, "elsewhere.txt"), "moved\n");
    sh(["add", "elsewhere.txt"]);
    sh([
      "-c",
      "user.name=Someone",
      "-c",
      "user.email=someone@example.com",
      "commit",
      "-q",
      "-m",
      "x",
    ]);
    sh(["push", "-q", "origin", `HEAD:refs/heads/${repo.runBranch}`]);

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const result = await fix(["F2"], "tests/gate.test.ts");

    expect(result.code).toBe(1);
    expect(result.err).toContain("✗ pull request not updated");
    expect(result.err).toContain("git pull --no-rebase");
    expect(result.err).toContain(`phax finding post ${repo.shortName} F2`);
  });

  it("keeps the fate when a comment fails, and phax finding post then posts without recording again", async () => {
    setPublishAuto(repo, true);
    installFakeGh(repo, "fails");

    const failed = await dismiss("F3");
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("✗ pull request not updated");
    expect(failed.err).toContain(`phax finding post ${repo.shortName} F3`);
    expect((await fates())["F3"]).toBe("dismissed");

    installFakeGh(repo, "answers");
    const recordsBefore = head(repo, RECORDS_BRANCH);
    const callsBefore = ghComments(repo).length;
    const retried = await runnerCall([findingGroup], ["finding", "post", repo.shortName, "F3"]);

    expect(retried.code).toBe(0);
    const comments = ghComments(repo);
    expect(comments).toHaveLength(callsBefore + 1);
    expect(comments.at(-1)?.pullRequest).toBe(prUrl);
    expect(comments.at(-1)?.body).toContain("F3");
    expect(head(repo, RECORDS_BRANCH)).toBe(recordsBefore);
    expect((await fates())["F3"]).toBe("dismissed");
  });

  it("pushes and posts nothing when the fate's record fails", async () => {
    setPublishAuto(repo, true);
    installFakeGh(repo, "answers");
    const remoteBefore = remoteHead(repo);
    lockRecordsBranch(repo);

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const result = await fix(["F2"], "tests/gate.test.ts", "--json");

    expect(result.code).toBe(1);
    expect(JSON.stringify(jsonError(result))).toContain("FindingFateNotRecordedError");
    expect(ghCalls(repo)).toEqual([]);
    expect(remoteHead(repo)).toBe(remoteBefore);
  });

  it("comments naming the commit when --commit records an earlier run-branch commit", async () => {
    setPublishAuto(repo, true);
    installFakeGh(repo, "answers");
    const earlier = runBranchHead();
    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 2;\n");
    const made = await fix(["F2"], "src/app/gate.ts");
    expect(made.code).toBe(0);
    const before = ghComments(repo).length;

    const result = await runnerCall(
      [findingGroup],
      ["finding", "fix", repo.shortName, "F3", "--commit", earlier, "--by", "operator"],
    );

    expect(result.code).toBe(0);
    const comments = ghComments(repo);
    expect(comments).toHaveLength(before + 1);
    expect(comments.at(-1)?.body).toContain("F3");
    expect(comments.at(-1)?.body).toContain(earlier.slice(0, 7));
    expect(result.out).toContain("✓ commented F3 on");
  });

  it("stops fix from pushing or posting with publish.pushBranch off, while dismiss still posts", async () => {
    const file = join(repo.repoDir, "phax.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(
      file,
      JSON.stringify({ ...config, publish: { auto: true, pushBranch: false } }, null, 2),
    );
    installFakeGh(repo, "answers");
    const remoteBefore = remoteHead(repo);

    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const fixed = await fix(["F2"], "tests/gate.test.ts", "--json");
    expect(fixed.code).toBe(0);
    expect(pullRequestOf(fixed)).toEqual({ kind: "not-posted", reason: "push-branch-off" });
    expect(remoteHead(repo)).toBe(remoteBefore);
    expect(ghCalls(repo)).toEqual([]);

    const dismissed = await dismiss("F3", "--json");
    expect(dismissed.code).toBe(0);
    const posted = pullRequestOf(dismissed);
    expect(posted["kind"]).toBe("posted");
    expect(posted["url"]).toBe(prUrl);
    expect(posted["pushed"]).toBeNull();
    expect(posted["comments"]).toHaveLength(1);
    expect(ghComments(repo)).toHaveLength(1);
    expect(remoteHead(repo)).toBe(remoteBefore);
  });
});
