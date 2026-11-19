import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { head, writeInWorktree } from "../fixtures/findings/fateRunRepo.js";
import { reviewOnce } from "../fixtures/findings/findingRunRepo.js";
import {
  buildPrRunRepo,
  findingsSection,
  ghCalls,
  ghComments,
  installFakeGh,
  type PrRunRepo,
  publishPr,
  remoteHead,
  setPublishAuto,
} from "../fixtures/findings/prRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// The fate commands of a run whose pull request exists, with publish.auto on: `fix` pushes the run
// branch and comments, `dismiss` and `defer` comment, and the description is never rewritten.
// Each test fails today: the fate commands neither push nor run gh. Phase-07 passes them.

describe("fate commands update the pull request", () => {
  let repo: PrRunRepo;
  let origCwd: string;
  let prUrl: string;

  beforeEach(async () => {
    repo = buildPrRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
    await reviewOnce(repo, ["one", "two", "three", "four", "five"]);
    const published = await publishPr(repo);
    expect(published.code).toBe(0);
    expect(published.prUrl).not.toBeNull();
    prUrl = published.prUrl as string;
    setPublishAuto(repo, true);
    installFakeGh(repo, "answers");
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const fix = (ids: readonly string[], path: string) =>
    runnerCall(
      [findingGroup],
      ["finding", "fix", repo.shortName, ...ids, "--by", "operator", "--", path],
    );
  const runBranchHead = () => head(repo, repo.runBranch) as string;

  // AC-pr-fix-pushes-and-comments
  it("a fix pushes the run branch, then comments on F2 naming the commit", async () => {
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const result = await fix(["F2"], "tests/gate.test.ts");
    expect(result.code).toBe(0);
    const newHead = runBranchHead();

    expect(remoteHead(repo)).toBe(newHead);
    const comments = ghComments(repo);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.pullRequest).toBe(prUrl);
    expect(comments[0]?.remoteHeadAtCall).toBe(newHead);
    expect(comments[0]?.body).toContain("F2");
    expect(comments[0]?.body).toContain("fixed");
    expect(comments[0]?.body).toContain(newHead.slice(0, 7));
  });

  // AC-pr-fix-pushes-and-comments
  it("a fix naming F2 and F5 posts one comment per finding, in order", async () => {
    writeInWorktree(repo, "tests/gate.test.ts", "export const gateTest = 2;\n");
    const result = await fix(["F2", "F5"], "tests/gate.test.ts");
    expect(result.code).toBe(0);
    const short = runBranchHead().slice(0, 7);

    const comments = ghComments(repo);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.body).toContain("F2");
    expect(comments[0]?.body).not.toContain("F5");
    expect(comments[1]?.body).toContain("F5");
    expect(comments[0]?.body).toContain(short);
    expect(comments[1]?.body).toContain(short);
  });

  // AC-pr-description-not-rewritten
  it("a fix leaves the description as written and reaches the pull request as a comment", async () => {
    const bodyFile = join(repo.runFolder, "pr-body.md");
    const before = readFileSync(bodyFile, "utf8");
    const section = findingsSection(before);
    expect(section).not.toBeNull();
    const openAt = (section as string).indexOf("Open (5)");
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect((section as string).slice(openAt)).toMatch(/^- F4 /m);

    writeInWorktree(repo, "src/app/gate.ts", "export const gate = 2;\n");
    const result = await fix(["F4"], "src/app/gate.ts");
    expect(result.code).toBe(0);

    expect(readFileSync(bodyFile, "utf8")).toBe(before);
    const calls = ghCalls(repo);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.slice(0, 2)).toEqual(["pr", "comment"]);
    const comments = ghComments(repo);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("F4");
    expect(comments[0]?.body).toContain("fixed");
  });

  // AC-pr-dismiss-defer-comment
  it("a dismissal and a deferral each comment with the reason or pointer, and push nothing", async () => {
    const remoteBefore = remoteHead(repo);

    const dismissed = await runnerCall(
      [findingGroup],
      [
        "finding",
        "dismiss",
        repo.shortName,
        "F3",
        "--by",
        "operator",
        "--why",
        "the second check guards --resume",
      ],
    );
    expect(dismissed.code).toBe(0);
    const deferred = await runnerCall(
      [findingGroup],
      [
        "finding",
        "defer",
        repo.shortName,
        "F5",
        "--by",
        "operator",
        "--to",
        "docs/briefs/gate-retry-docs.md",
        "--why",
        "docs pass after the gate rework",
      ],
    );
    expect(deferred.code).toBe(0);

    const comments = ghComments(repo);
    expect(comments).toHaveLength(2);
    expect(comments[0]?.body).toContain("F3");
    expect(comments[0]?.body).toContain("dismissed");
    expect(comments[0]?.body).toContain("the second check guards --resume");
    expect(comments[1]?.body).toContain("F5");
    expect(comments[1]?.body).toContain("deferred");
    expect(comments[1]?.body).toContain("docs/briefs/gate-retry-docs.md");
    expect(remoteHead(repo)).toBe(remoteBefore);
  });
});
