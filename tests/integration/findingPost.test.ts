import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { head, writeInWorktree } from "../fixtures/findings/fateRunRepo.js";
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

// `phax finding post` through the runner, over the run of tests/fixtures/findings/prRunRepo.ts
// with its pull request created through the fake GitHub port and a made-up `gh` on PATH that
// logs every call. publish.auto is off in every test: the fate commands post nothing on their
// own, so each comment here is one `finding post` made.

const RECORDS_BRANCH = "phax/records/v1";

describe("phax finding post", () => {
  let repo: PrRunRepo;
  let origCwd: string;
  let prUrl: string;
  const scratch: string[] = [];

  beforeEach(async () => {
    repo = buildPrRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
    setPublishAuto(repo, false);
    installFakeGh(repo, "answers");
    await reviewOnce(repo, ["one", "two", "three", "four"]);
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

  const post = (...ids: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "post", repo.shortName, ...ids]);
  const fix = (id: string, path: string) =>
    runnerCall(
      [findingGroup],
      ["finding", "fix", repo.shortName, id, "--by", "operator", "--", path],
    );
  const dismiss = (id: string, why: string) =>
    runnerCall(
      [findingGroup],
      ["finding", "dismiss", repo.shortName, id, "--by", "operator", "--why", why],
    );
  const fixF2 = async () => {
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    expect((await fix("F2", "tests/gate.test.ts")).code).toBe(0);
  };
  const runBranchHead = () => head(repo, repo.runBranch) as string;

  // AC-pr-fix-pushes-and-comments (the verb that retries it)
  it("pushes the run branch before it comments on a fixed finding, and writes no record", async () => {
    await fixF2();
    const recordsBefore = head(repo, RECORDS_BRANCH);
    expect(remoteHead(repo)).not.toBe(runBranchHead());
    expect(ghCalls(repo)).toEqual([]);

    const result = await post("F2");
    expect(result.code).toBe(0);

    expect(remoteHead(repo)).toBe(runBranchHead());
    const comments = ghComments(repo);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.pullRequest).toBe(prUrl);
    expect(comments[0]?.body).toContain("F2 fixed");
    expect(comments[0]?.body).toContain(`Fixed by ${runBranchHead().slice(0, 7)}`);
    expect(comments[0]?.remoteHeadAtCall).toBe(runBranchHead());
    expect(head(repo, RECORDS_BRANCH)).toBe(recordsBefore);
    expect(result.out).toContain("✓ pushed");
    expect(result.out).toContain(`✓ commented F2 on ${prUrl}`);
  });

  it("posts a dismissal's reason without pushing, one comment per finding in the order named", async () => {
    await fixF2();
    expect((await dismiss("F3", "the second check guards --resume")).code).toBe(0);
    const remoteBefore = remoteHead(repo);

    const dismissed = await post("F3");
    expect(dismissed.code).toBe(0);
    expect(remoteHead(repo)).toBe(remoteBefore);
    expect(dismissed.out).not.toContain("✓ pushed");
    expect(ghComments(repo)).toHaveLength(1);
    expect(ghComments(repo)[0]?.body).toContain("F3 dismissed");
    expect(ghComments(repo)[0]?.body).toContain("Reason: the second check guards --resume");

    const both = await post("F3", "F2", "F3");
    expect(both.code).toBe(0);
    expect(ghComments(repo).map((comment) => comment.body?.slice(0, 2))).toEqual([
      "F3",
      "F3",
      "F2",
    ]);
  });

  it("refuses an open finding, an unknown id and a run with no publication record before any call", async () => {
    await fixF2();
    const recordsBefore = head(repo, RECORDS_BRANCH);
    const remoteBefore = remoteHead(repo);

    const open = await post("F2", "F4");
    expect(open.code).toBe(1);
    expect(open.err).toContain("F4 is open: it has no fate to post");

    const unknown = await post("F9");
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("F9");

    const notAnId = await post("gate");
    expect(notAnId.code).toBe(1);
    expect(notAnId.err).toContain("not a finding id");

    rmSync(join(repo.runFolder, "publication.json"));
    const none = await post("F2");
    expect(none.code).toBe(1);
    expect(none.err).toContain("has no pull request phax opened");

    expect(ghCalls(repo)).toEqual([]);
    expect(remoteHead(repo)).toBe(remoteBefore);
    expect(head(repo, RECORDS_BRANCH)).toBe(recordsBefore);
  });

  it("refuses a publication record whose pull request failed", async () => {
    await fixF2();
    const file = join(repo.runFolder, "publication.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        enabled: true,
        provider: "github",
        remote: "origin",
        branch: repo.runBranch,
        pushStatus: "pushed",
        prStatus: "failed",
        createdAt: "2026-11-01T10:00:00.000Z",
      }),
    );
    const result = await post("F2");
    expect(result.code).toBe(1);
    expect(result.err).toContain("has no pull request phax opened");
    expect(ghCalls(repo)).toEqual([]);
  });

  it("exits 1 naming the post retry when a comment fails, and leaves the records alone", async () => {
    await fixF2();
    const recordsBefore = head(repo, RECORDS_BRANCH);
    installFakeGh(repo, "fails");

    const result = await post("F2");
    expect(result.code).toBe(1);
    expect(result.err).toContain("✗ pull request not updated");
    expect(result.err).toContain("gh: offline");
    expect(result.err).toContain(`phax finding post ${repo.shortName} F2`);
    expect(head(repo, RECORDS_BRANCH)).toBe(recordsBefore);
  });

  it("exits 1 with nothing posted when the remote branch has moved, saying how to bring it in", async () => {
    await fixF2();
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
    const recordsBefore = head(repo, RECORDS_BRANCH);

    const result = await post("F2");
    expect(result.code).toBe(1);
    expect(result.err).toContain("git pull --no-rebase");
    expect(result.err).toContain(`phax finding post ${repo.shortName} F2`);
    expect(ghComments(repo)).toEqual([]);
    expect(remoteHead(repo)).toBe(moved);
    expect(head(repo, RECORDS_BRANCH)).toBe(recordsBefore);
  });

  it("answers { run, pullRequest, findings } under --json, and the not-updated error its fields", async () => {
    await fixF2();
    const ok = await runnerCall(
      [findingGroup],
      ["finding", "post", repo.shortName, "F2", "--json"],
    );
    expect(ok.code).toBe(0);
    const answer = JSON.parse(ok.out) as {
      run: { shortName: string };
      pullRequest: {
        url: string;
        pushed: { remote: string; branch: string; sha: string } | null;
        comments: { finding: string; url: string }[];
      };
      findings: { id: string; fate: string }[];
    };
    expect(answer.run.shortName).toBe(repo.shortName);
    expect(answer.pullRequest.url).toBe(prUrl);
    expect(answer.pullRequest.pushed).toEqual({
      remote: "origin",
      branch: repo.runBranch,
      sha: runBranchHead(),
    });
    expect(answer.pullRequest.comments).toHaveLength(1);
    expect(answer.pullRequest.comments[0]?.finding).toBe("F2");
    expect(answer.findings.map((f) => [f.id, f.fate])).toEqual([["F2", "fixed"]]);

    installFakeGh(repo, "fails");
    const failed = await runnerCall(
      [findingGroup],
      ["finding", "post", repo.shortName, "F2", "--json"],
    );
    expect(failed.code).toBe(1);
    const text = failed.err.length > 0 ? failed.err : failed.out;
    const error = JSON.parse(text.trim().split("\n").at(-1) as string) as Record<string, unknown>;
    expect(JSON.stringify(error)).toContain("FindingPullRequestNotUpdatedError");
    expect(JSON.stringify(error)).toContain(`phax finding post ${repo.shortName} F2`);
    expect(error).toBeDefined();
  });
});
