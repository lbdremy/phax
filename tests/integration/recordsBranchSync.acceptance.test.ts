import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { readRecordsBranch } from "../../src/app/recordsBranch.js";
import {
  syncRecordsBranch,
  type RecordsBranchOutcome,
  type RecordsBranchSyncResult,
} from "../../src/app/recordsBranchSync.js";
import { computeRecordsPending } from "../../src/app/recordsStatus.js";
import { pushRecordsBranch } from "../../src/app/recordsSync.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import {
  BRANCH_REF,
  PUBLISH_REMOTE,
  branchReflog,
  branchUpdatesSince,
  buildBranchTipWorld,
  git,
  isAncestor,
  putBranchAhead,
  putBranchBehind,
  putBranchDiverged,
  putKeyCollision,
  putBranchUnrelated,
  withGitTrace,
  type BranchTipOptions,
  type BranchTipWorld,
  type Destination,
} from "../fixtures/records/branchTipRepos.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";

// Acceptance tests of spec records-branch-tip §5.4–§5.8 and §5.12, frozen until the phase that
// implements `syncRecordsBranch` and the `records sync --replay` command: every test carries
// `.fails`, because the use case is a stub and the command still only fetches. Each runs on real
// git repositories (tests/fixtures/records/branchTipRepos.ts) in a temporary directory, with git
// isolated from the person's configuration.
//   ac-fresh-clone, ac-behind, ac-sync-refuse, ac-replay, ac-replay-collision and ac-never-forced. ac-replay-collision follows the
// operator decision of 2026-11-06 amending §5.8: a shared key no longer refuses the replay.

const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer);
const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let restoreGit: () => void;
const worlds: BranchTipWorld[] = [];

beforeEach(() => {
  restoreGit = isolateGit();
});

afterEach(() => {
  // Newest first: each world put back the environment its predecessor had set.
  for (const world of worlds.splice(0).toReversed()) world.cleanup();
  restoreGit();
});

async function newWorld(options?: BranchTipOptions): Promise<BranchTipWorld> {
  const world = await buildBranchTipWorld(options);
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

/** What sync did to the branch, once it has fetched (or cloned) and nothing refused it. */
function branchOf(result: RecordsBranchSyncResult): RecordsBranchOutcome {
  if (result.kind !== "cloned" && result.kind !== "fetched") {
    throw new Error(`expected cloned or fetched, got ${result.kind}`);
  }
  return result.branch;
}

const parentOf = (repo: string, sha: string): string => git(["rev-parse", `${sha}^`], repo);
const tipOf = (repo: string): string => git(["rev-parse", BRANCH_REF], repo);

/** A commit's raw bytes: its author line, and its message exactly as stored. */
function rawCommit(repo: string, sha: string): { author: string; message: string } {
  const raw = execFileSync("git", ["cat-file", "commit", sha], { cwd: repo, encoding: "utf8" });
  const split = raw.indexOf("\n\n");
  const headers = raw.slice(0, split).split("\n");
  return {
    author: headers.find((line) => line.startsWith("author ")) ?? "",
    message: raw.slice(split + 2),
  };
}

function pendingCount(world: BranchTipWorld, destination: Destination): Promise<number> {
  return Effect.runPromise(
    Effect.provide(
      computeRecordsPending({
        records: destination === "dedicated" ? world.dedicated : world.inRepo,
        repoRoot: world.sourceRepo,
        publishRemote: PUBLISH_REMOTE,
        recordsClonePath: destination === "dedicated" ? world.clonePath : undefined,
      }),
      NodeGitLayer,
    ),
  ).then((status) => status.pending.length);
}

function push(world: BranchTipWorld, destination: Destination) {
  return Effect.runPromise(
    Effect.provide(
      pushRecordsBranch({
        records: destination === "dedicated" ? world.dedicated : world.inRepo,
        repoRoot: world.sourceRepo,
        publishRemote: PUBLISH_REMOTE,
        recordsClonePath: destination === "dedicated" ? world.clonePath : undefined,
      }),
      NodeGitLayer,
    ),
  );
}

describe("phax records sync creates the missing branch", () => {
  // ac-fresh-clone
  it("ac-fresh-clone: after a fresh clone, two phase records descend from origin's tip and push as a fast-forward", async () => {
    const world = await newWorld({ remoteRecords: 4 });
    const remoteTip = world.remoteTip();

    const result = await runSync(world, "dedicated");

    expect(result.kind).toBe("cloned");
    expect(branchOf(result)).toEqual({ kind: "created", tip: remoteTip, records: 4 });
    expect(tipOf(world.clonePath)).toBe(remoteTip);

    const [first, second] = await world.writePhaseRecords("dedicated", 2);
    if (first === undefined || second === undefined) throw new Error("two records expected");
    expect(parentOf(world.clonePath, first)).toBe(remoteTip);
    expect(parentOf(world.clonePath, second)).toBe(first);
    expect(isAncestor(world.clonePath, remoteTip, second)).toBe(true);

    const pushed = await push(world, "dedicated");
    expect(pushed.kind).toBe("pushed");
    expect(world.remoteTip()).toBe(second);

    const reading = await Effect.runPromise(
      Effect.provide(readRecordsBranch(world.clonePath, "origin"), NodeGitLayer),
    );
    expect(reading).toEqual({ state: "in-sync", localTip: second, remoteTip: second });
    expect(await pendingCount(world, "dedicated")).toBe(0);
  });
});

describe("phax records sync fast-forwards a branch that is behind", () => {
  // ac-behind
  it("ac-behind: fast-forwards to the remote tip, names both tips, and the next record parents on it", async () => {
    const world = await newWorld({ remoteRecords: 3 });
    const behind = await putBranchBehind(world, { newRecords: 2 });
    const oldTip = behind.localTip;
    const remoteTip = world.remoteTip();
    expect(oldTip).not.toBe(remoteTip);
    expect(behind.remoteTip).toBe(remoteTip);

    const result = await runSync(world, "dedicated");

    expect(result.kind).toBe("fetched");
    expect(branchOf(result)).toEqual({ kind: "fast-forwarded", from: oldTip, to: remoteTip });
    expect(tipOf(world.clonePath)).toBe(remoteTip);

    const [next] = await world.writePhaseRecords("dedicated", 1);
    if (next === undefined) throw new Error("one record expected");
    expect(parentOf(world.clonePath, next)).toBe(remoteTip);
  });
});

describe("phax records sync without --replay refuses a branch that has split", () => {
  for (const state of ["unrelated", "diverged"] as const) {
    // ac-sync-refuse
    it(`ac-sync-refuse: the use case answers ${state} with both tips and the local-only count, and moves nothing`, async () => {
      const world = await newWorld();
      const split =
        state === "unrelated"
          ? await putBranchUnrelated(world, { localOnly: 3 })
          : await putBranchDiverged(world, { localOnly: 3, remoteNew: 1 });
      const localTip = tipOf(world.clonePath);
      expect(localTip).toBe(split.localTip);

      const result = await runSync(world, "dedicated");

      expect(result).toEqual({
        kind: "diverged",
        reason: state,
        path: world.clonePath,
        remote: world.remoteUrl,
        localTip,
        remoteTip: world.remoteTip(),
        localOnly: 3,
        remedy: "phax records sync --replay",
      });
      expect(result).toMatchObject({ localTip: expect.stringMatching(/^[0-9a-f]{40}$/) });
      expect(tipOf(world.clonePath)).toBe(localTip);
    });

    // ac-sync-refuse
    it(`ac-sync-refuse: \`phax records sync --json\` on a ${state} branch exits 1 with the normative error fields`, async () => {
      const world = await newWorld();
      if (state === "unrelated") await putBranchUnrelated(world, { localOnly: 3 });
      else await putBranchDiverged(world, { localOnly: 3, remoteNew: 1 });
      const localTip = tipOf(world.clonePath);
      const remoteTip = world.remoteTip();

      const result = spawnSync("tsx", [mainTs, "records", "sync", "--json"], {
        cwd: world.sourceRepo,
        encoding: "utf8",
        env: phaxHomeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      expect(result.status, result.stderr).toBe(1);
      const lines = result.stderr
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const error = lines.find((line) => line["kind"] === "error");
      expect(error, result.stderr).toBeDefined();
      expect(error?.["exit"]).toBe(1);
      expect(error?.["fields"]).toMatchObject({
        reason: state,
        localTip,
        remoteTip,
        localOnly: 3,
        remedy: "phax records sync --replay",
      });
      expect(tipOf(world.clonePath)).toBe(localTip);
    });
  }
});

describe("phax records sync --replay brings stranded records home", () => {
  for (const state of ["unrelated", "diverged"] as const) {
    // ac-replay
    it(`ac-replay: replays the 3 local-only records of a ${state} branch onto the remote tip, then it pushes as a fast-forward`, async () => {
      const world = await newWorld();
      const split =
        state === "unrelated"
          ? await putBranchUnrelated(world, { localOnly: 3 })
          : await putBranchDiverged(world, { localOnly: 3, remoteNew: 1 });
      const previousTip = tipOf(world.clonePath);
      const remoteTip = world.remoteTip();

      const result = await runSync(world, "dedicated", true);

      expect(result.kind).toBe("fetched");
      const newTip = tipOf(world.clonePath);
      expect(branchOf(result)).toEqual({
        kind: "replayed",
        count: 3,
        skipped: 0,
        sharedKeys: [],
        previousTip,
        newTip,
        remoteTip,
      });

      // Exactly three new commits on the remote tip, one per original, in order.
      expect(isAncestor(world.clonePath, remoteTip, newTip)).toBe(true);
      const replayed = git(["rev-list", "--reverse", `${remoteTip}..${newTip}`], world.clonePath)
        .split("\n")
        .filter((sha) => sha !== "");
      expect(replayed).toHaveLength(3);
      expect(parentOf(world.clonePath, replayed[0] ?? "")).toBe(remoteTip);
      for (const [index, sha] of replayed.entries()) {
        const original = split.localOnlyCommits[index] ?? "";
        if (index > 0) expect(parentOf(world.clonePath, sha)).toBe(replayed[index - 1]);
        expect(sha).not.toBe(original);
        expect(git(["rev-parse", `${sha}^{tree}`], world.clonePath)).toBe(
          git(["rev-parse", `${original}^{tree}`], world.clonePath),
        );
        expect(rawCommit(world.clonePath, sha)).toEqual(rawCommit(world.clonePath, original));
      }

      const reading = await Effect.runPromise(
        Effect.provide(readRecordsBranch(world.clonePath, "origin"), NodeGitLayer),
      );
      expect(reading).toEqual({ state: "ahead", localTip: newTip, remoteTip });
      expect(await pendingCount(world, "dedicated")).toBe(3);

      git(["push", "origin", "phax/records/v1"], world.clonePath);
      expect(world.remoteTip()).toBe(newTip);
    });
  }

  // ac-replay-collision
  it("ac-replay-collision: replays a key the remote holds with other content and names it; a record the remote holds file for file is left out", async () => {
    const world = await newWorld();
    const collision = await putKeyCollision(world);
    const remoteTip = world.remoteTip();
    // One more local-only commit: the very record the remote's collision commit holds.
    const sameTree = git(["rev-parse", `${collision.remoteCommit}^{tree}`], world.clonePath);
    const previousTip = tipOf(world.clonePath);
    const identical = git(
      ["commit-tree", sameTree, "-p", previousTip, "-m", "the remote's record, again"],
      world.clonePath,
    );
    git(["update-ref", BRANCH_REF, identical, previousTip], world.clonePath);

    const result = await runSync(world, "dedicated", true);

    expect(branchOf(result)).toMatchObject({
      kind: "replayed",
      count: 3,
      skipped: 1,
      sharedKeys: [collision.key],
      previousTip: identical,
      remoteTip,
    });
    const newTip = tipOf(world.clonePath);
    expect(isAncestor(world.clonePath, remoteTip, newTip)).toBe(true);
    const replayed = git(["rev-list", "--reverse", `${remoteTip}..${newTip}`], world.clonePath)
      .split("\n")
      .filter((line) => line !== "");
    expect(replayed).toHaveLength(3);
    expect(
      replayed.map((sha) => git(["rev-parse", `${sha}^{tree}`], world.clonePath)),
    ).not.toContain(sameTree);
  });
});

/** Every word of every traced git command that forces: `--force*` or a `+` refspec. */
function forcing(commands: readonly (readonly string[])[]): string[] {
  return commands.flat().filter((word) => word.startsWith("--force") || word.startsWith("+"));
}

function pushes(commands: readonly (readonly string[])[]): number {
  return commands.filter((words) => words[0] === "git" && words[1] === "push").length;
}

describe("no path forces the records branch", () => {
  // ac-never-forced
  it("ac-never-forced: fresh clone, behind, write-time, replay and push never force; every update fast-forwards or replays", async () => {
    // A fresh clone, two phase records written on it, and their push.
    const fresh = await newWorld();
    const freshClone = await withGitTrace(async () => {
      await runSync(fresh, "dedicated");
      await fresh.writePhaseRecords("dedicated", 2);
      return push(fresh, "dedicated");
    });
    expect(freshClone.value.kind).toBe("pushed");
    expect(pushes(freshClone.commands)).toBeGreaterThan(0);
    expect(forcing(freshClone.commands)).toEqual([]);
    const freshUpdates = branchUpdatesSince(fresh.clonePath, []);
    expect(freshUpdates.map((update) => update.kind)).toEqual([
      "create",
      "fast-forward",
      "fast-forward",
    ]);

    // A branch behind the remote, synced.
    const behindWorld = await newWorld();
    const behind = await putBranchBehind(behindWorld);
    const behindBefore = branchReflog(behindWorld.clonePath);
    const synced = await withGitTrace(() => runSync(behindWorld, "dedicated"));
    expect(forcing(synced.commands)).toEqual([]);
    expect(branchUpdatesSince(behindWorld.clonePath, behindBefore)).toEqual([
      { old: behind.localTip, new: behindWorld.remoteTip(), kind: "fast-forward" },
    ]);

    // A branch ahead of the remote: sync leaves it alone and says so.
    const aheadWorld = await newWorld();
    const ahead = await putBranchAhead(aheadWorld, { localOnly: 2 });
    const aheadBefore = branchReflog(aheadWorld.clonePath);
    const aheadSynced = await withGitTrace(() => runSync(aheadWorld, "dedicated"));
    expect(branchOf(aheadSynced.value)).toEqual({ kind: "unchanged", state: "ahead", pending: 2 });
    expect(forcing(aheadSynced.commands)).toEqual([]);
    expect(branchUpdatesSince(aheadWorld.clonePath, aheadBefore)).toEqual([]);
    expect(tipOf(aheadWorld.clonePath)).toBe(ahead.localTip);

    // A record written on a branch that is behind, with no sync first.
    const writeWorld = await newWorld();
    const stale = await putBranchBehind(writeWorld);
    const writeBefore = branchReflog(writeWorld.clonePath);
    const written = await withGitTrace(() => writeWorld.writePhaseRecords("dedicated", 1));
    expect(forcing(written.commands)).toEqual([]);
    const writeUpdates = branchUpdatesSince(writeWorld.clonePath, writeBefore);
    expect(writeUpdates).toEqual([
      { old: stale.localTip, new: written.value[0], kind: "fast-forward" },
    ]);

    // A replay of stranded records, then their push.
    const replayWorld = await newWorld();
    const stranded = await putBranchUnrelated(replayWorld, { localOnly: 3 });
    const replayBefore = branchReflog(replayWorld.clonePath);
    const replayRemoteTip = replayWorld.remoteTip();
    const replayed = await withGitTrace(async () => {
      await runSync(replayWorld, "dedicated", true);
      return push(replayWorld, "dedicated");
    });
    expect(replayed.value.kind).toBe("pushed");
    expect(pushes(replayed.commands)).toBeGreaterThan(0);
    expect(forcing(replayed.commands)).toEqual([]);
    const replayUpdates = branchUpdatesSince(replayWorld.clonePath, replayBefore);
    // The one update that is not a fast-forward is the replay: from the old tip onto the remote's.
    expect(replayUpdates).toHaveLength(1);
    const [replay] = replayUpdates;
    expect(replay?.kind).toBe("rewrite");
    expect(replay?.old).toBe(stranded.localTip);
    expect(isAncestor(replayWorld.clonePath, replayRemoteTip, replay?.new ?? "")).toBe(true);
    expect(
      git(
        ["rev-list", "--count", `${replayRemoteTip}..${replay?.new ?? ""}`],
        replayWorld.clonePath,
      ),
    ).toBe("3");
    expect(replayWorld.remoteTip()).toBe(replay?.new);

    // The same sync on an in-repo destination: missing locally, then behind.
    const inRepoMissing = await newWorld();
    const inRepoCreated = await withGitTrace(() => runSync(inRepoMissing, "in-repo"));
    expect(branchOf(inRepoCreated.value).kind).toBe("created");
    expect(forcing(inRepoCreated.commands)).toEqual([]);
    expect(branchUpdatesSince(inRepoMissing.sourceRepo, [])).toEqual([
      { old: null, new: inRepoMissing.remoteTip(), kind: "create" },
    ]);

    const inRepoBehind = await newWorld();
    const old = await putBranchBehind(inRepoBehind, { destination: "in-repo", fetched: false });
    const inRepoBefore = branchReflog(inRepoBehind.sourceRepo);
    const inRepoSynced = await withGitTrace(() => runSync(inRepoBehind, "in-repo"));
    expect(branchOf(inRepoSynced.value)).toEqual({
      kind: "fast-forwarded",
      from: old.localTip,
      to: inRepoBehind.remoteTip(),
    });
    expect(forcing(inRepoSynced.commands)).toEqual([]);
    expect(branchUpdatesSince(inRepoBehind.sourceRepo, inRepoBefore)).toEqual([
      { old: old.localTip, new: inRepoBehind.remoteTip(), kind: "fast-forward" },
    ]);
  });
});
