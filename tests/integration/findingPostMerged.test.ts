import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findingGroup } from "../../src/cli/definitions/finding.js";
import { head } from "../fixtures/findings/fateRunRepo.js";
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
import {
  deleteRunBranch,
  dropUnreachable,
  fixInWorktree,
  holds,
  rebaseAndMerge,
  squashMerge,
} from "../fixtures/findings/rewriteRunRepo.js";
import { runnerCall } from "../helpers/runnerCall.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax finding post` on a merged pull request (spec finding-fix-identity §5.12 to §5.14), over
// the run of tests/fixtures/findings/prRunRepo.ts with its pull request created through the fake
// GitHub port, its history rewritten by tests/fixtures/findings/rewriteRunRepo.ts the way a merge
// does, and a made-up `gh` on PATH that answers the pull request MERGED and logs every call.
// publish.auto is off: each comment here is one `finding post` made.

const RECORDS_BRANCH = "phax/records/v1";

describe("phax finding post on a merged pull request", () => {
  let repo: PrRunRepo;
  let origCwd: string;
  let prUrl: string;

  beforeEach(async () => {
    repo = buildPrRunRepo();
    origCwd = process.cwd();
    process.chdir(repo.repoDir);
    setPublishAuto(repo, false);
    installFakeGh(repo, "answers");
    await reviewOnce(repo, ["one", "two", "three", "four", "five"]);
    const published = await publishPr(repo);
    expect(published.code).toBe(0);
    if (published.prUrl === null) throw new Error("publish-pr recorded no pull request");
    prUrl = published.prUrl;
  });

  afterEach(() => {
    process.chdir(origCwd);
    repo.cleanup();
  });

  const post = (...ids: readonly string[]) =>
    runnerCall([findingGroup], ["finding", "post", repo.shortName, ...ids]);

  // ac-post-merged
  it("posts the fix Rebase and merge recreated, naming its new sha on main and the fate key, and pushes nothing", async () => {
    const fix = await fixInWorktree(repo, ["F2"], "tests/gate.test.ts", "export const t = 2;\n");
    const main = rebaseAndMerge(repo);
    expect(main).not.toBe(fix);
    installFakeGh(repo, "answers", "MERGED");
    const remoteBefore = remoteHead(repo);
    const recordsBefore = head(repo, RECORDS_BRANCH);

    const result = await post("F2");
    expect(result.code).toBe(0);

    const comments = ghComments(repo);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.pullRequest).toBe(prUrl);
    expect(comments[0]?.body?.split("\n")[1]).toBe(
      `Fixed by ${main.slice(0, 7)} on main (tests) · ${repo.runId} F2`,
    );
    expect(ghCalls(repo).map((call) => call.slice(0, 2))).toEqual([
      ["pr", "view"],
      ["pr", "comment"],
    ]);
    expect(remoteHead(repo)).toBe(remoteBefore);
    expect(head(repo, RECORDS_BRANCH)).toBe(recordsBefore);
    expect(result.out.trimEnd().split("\n")).toEqual([
      `✓ F2: ${main.slice(0, 7)} on main (by key)`,
      `✓ commented F2 on ${prUrl} (nothing pushed: the pull request is merged)`,
    ]);
  });

  it("answers pullRequestState merged and no push under --json", async () => {
    await fixInWorktree(repo, ["F2"], "tests/gate.test.ts", "export const t = 2;\n");
    rebaseAndMerge(repo);
    installFakeGh(repo, "answers", "MERGED");

    const result = await runnerCall(
      [findingGroup],
      ["finding", "post", repo.shortName, "F2", "--json"],
    );
    expect(result.code).toBe(0);
    const answer: unknown = JSON.parse(result.out);
    expect(answer).toMatchObject({
      pullRequestState: "merged",
      pullRequest: { pushed: null, comments: [{ finding: "F2" }] },
    });
  });

  // ac-post-merged-refused
  it("refuses a fix squashed with a description only, naming both branches and the --commit retry, before any comment", async () => {
    const fix = await fixInWorktree(repo, ["F5"], "src/app/five.ts", "export const five = 5;\n");
    squashMerge(repo, "description");
    deleteRunBranch(repo);
    dropUnreachable(repo);
    expect(holds(repo, fix)).toBe(false);
    installFakeGh(repo, "answers", "MERGED");
    const remoteBefore = remoteHead(repo);

    const result = await post("F5");
    expect(result.code).not.toBe(0);
    expect(result.err).toContain(
      `✗ post refused: F5 of ${repo.shortName} is fixed by ${fix.slice(0, 7)}, found on neither main nor ${repo.runBranch}: nothing was commented. Record the commit that carries the fix with: phax finding fix ${repo.shortName} F5 --commit <sha>`,
    );
    expect(ghComments(repo)).toEqual([]);
    expect(ghCalls(repo)).toEqual([["pr", "view", prUrl, "--json", "state"]]);
    expect(remoteHead(repo)).toBe(remoteBefore);
  });

  it("refuses a fix found on the run branch only, saying it is not on the base branch", async () => {
    const fix = await fixInWorktree(repo, ["F2"], "tests/gate.test.ts", "export const t = 2;\n");
    installFakeGh(repo, "answers", "MERGED");

    const result = await post("F2");
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `F2 of ${repo.shortName} is fixed by ${fix.slice(0, 7)}, found on ${repo.runBranch} but not on main: nothing was commented.`,
    );
    expect(ghComments(repo)).toEqual([]);
  });
});
