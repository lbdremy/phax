import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import {
  syncRecordsBranch,
  type RecordsBranchSyncResult,
} from "../../src/app/recordsBranchSync.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import {
  BRANCH_REF,
  PUBLISH_REMOTE,
  branchReflog,
  buildBranchTipWorld,
  git,
  type BranchTipWorld,
  type Destination,
} from "../fixtures/records/branchTipRepos.js";
import { isolateGit } from "../helpers/isolateGit.js";

// In-phase tests of `syncRecordsBranch` for what the acceptance tests leave out: `--replay` on a
// branch that has not split, an in-repo `publish.remote` with no records branch, and an in-repo
// sync leaving the source repository's working tree, index and HEAD as they were.

const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer);

let restoreGit: () => void;
const worlds: BranchTipWorld[] = [];

beforeEach(() => {
  restoreGit = isolateGit();
});

afterEach(() => {
  for (const world of worlds.splice(0).toReversed()) world.cleanup();
  restoreGit();
});

async function newWorld(): Promise<BranchTipWorld> {
  const world = await buildBranchTipWorld();
  worlds.push(world);
  return world;
}

function runSync(
  world: BranchTipWorld,
  destination: Destination,
  replay = false,
): Promise<RecordsBranchSyncResult> {
  return Effect.runPromise(
    Effect.provide(
      syncRecordsBranch({
        records: destination === "dedicated" ? world.dedicated : world.inRepo,
        stateRoot: world.stateRoot,
        namespace: world.namespace,
        repoRoot: world.sourceRepo,
        publishRemote: PUBLISH_REMOTE,
        replay,
      }),
      LAYER,
    ),
  );
}

describe("phax records sync --replay on a branch that has not split", () => {
  it("replays nothing, reports the in-sync state and leaves the branch where it was", async () => {
    const world = await newWorld();
    const created = await runSync(world, "dedicated");
    expect(created).toMatchObject({ kind: "cloned", branch: { kind: "created" } });
    const tip = git(["rev-parse", BRANCH_REF], world.clonePath);
    const reflog = branchReflog(world.clonePath);

    const result = await runSync(world, "dedicated", true);

    expect(result).toEqual({
      kind: "fetched",
      path: world.clonePath,
      remote: world.remoteUrl,
      branch: { kind: "unchanged", state: "in-sync", pending: 0 },
    });
    expect(git(["rev-parse", BRANCH_REF], world.clonePath)).toBe(tip);
    expect(branchReflog(world.clonePath)).toEqual(reflog);
  });
});

describe("phax records sync on an in-repo destination", () => {
  it("answers no-remote-branch without error when publish.remote holds no records branch", async () => {
    const world = await newWorld();
    // Point publish.remote at an empty repository, then write one record locally.
    const empty = join(world.base, "empty.git");
    git(["init", "-q", "--bare", empty], world.base);
    git(["remote", "set-url", PUBLISH_REMOTE, empty], world.sourceRepo);
    const [record] = await world.writePhaseRecords("in-repo", 1);

    const result = await runSync(world, "in-repo");

    expect(result).toEqual({
      kind: "fetched",
      path: world.sourceRepo,
      remote: PUBLISH_REMOTE,
      branch: { kind: "unchanged", state: "no-remote-branch", pending: 1 },
    });
    expect(git(["rev-parse", BRANCH_REF], world.sourceRepo)).toBe(record);
    expect(git(["for-each-ref", `refs/remotes/${PUBLISH_REMOTE}`], world.sourceRepo)).toBe("");
  });

  it("fetches only the records branch and leaves the working tree, index and HEAD untouched", async () => {
    const world = await newWorld();
    const repo = world.sourceRepo;
    // A staged change and an unstaged one, so an index or checkout write would show.
    writeFileSync(join(repo, "staged.txt"), "staged\n");
    git(["add", "staged.txt"], repo);
    writeFileSync(join(repo, "dirty.txt"), "dirty\n");
    const before = {
      head: git(["symbolic-ref", "HEAD"], repo),
      headSha: git(["rev-parse", "HEAD"], repo),
      status: git(["status", "--porcelain=v1", "--untracked-files=all"], repo),
      index: readFileSync(join(repo, ".git", "index")),
      refs: git(["for-each-ref", "--format=%(refname) %(objectname)"], repo),
    };

    const result = await runSync(world, "in-repo");

    expect(result).toMatchObject({ kind: "fetched", branch: { kind: "created" } });
    expect(git(["symbolic-ref", "HEAD"], repo)).toBe(before.head);
    expect(git(["rev-parse", "HEAD"], repo)).toBe(before.headSha);
    expect(git(["status", "--porcelain=v1", "--untracked-files=all"], repo)).toBe(before.status);
    expect(readFileSync(join(repo, ".git", "index")).equals(before.index)).toBe(true);
    // The only refs that appeared are the records branch and its remote-tracking ref.
    const after = git(["for-each-ref", "--format=%(refname) %(objectname)"], repo).split("\n");
    const added = after.filter((ref) => !before.refs.split("\n").includes(ref));
    const remoteTip = world.remoteTip();
    expect(added.toSorted()).toEqual(
      [
        `${BRANCH_REF} ${remoteTip}`,
        `refs/remotes/${PUBLISH_REMOTE}/phax/records/v1 ${remoteTip}`,
      ].toSorted(),
    );
  });
});
