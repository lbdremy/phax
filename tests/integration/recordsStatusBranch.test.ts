import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { describeRecordsPushFailure } from "../../src/app/recordsBranch.js";
import { computeRecordsPending } from "../../src/app/recordsStatus.js";
import { pushRecordsBranch } from "../../src/app/recordsSync.js";
import { decisionRecordPushWarning } from "../../src/app/writeDecisionRecord.js";
import { reviewRecordPushWarning } from "../../src/app/writeReviewRecord.js";
import { recordPushWarning } from "../../src/app/authorArtifact.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import {
  BRANCH_REF,
  PUBLISH_REMOTE,
  buildBranchTipWorld,
  git,
  putBranchAhead,
  putBranchBehind,
  putBranchDiverged,
  putBranchUnrelated,
  type BranchTipWorld,
  type PreparedBranch,
} from "../fixtures/records/branchTipRepos.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";

// `phax records status` reports the branch state; a refused push names the state and the fix.
//   ac-status-states, ac-status-pending and ac-push-message.

const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer);
const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let restoreGit: () => void;
const worlds: BranchTipWorld[] = [];

beforeEach(() => {
  restoreGit = isolateGit();
});

afterEach(() => {
  for (const world of worlds.splice(0).toReversed()) world.cleanup();
  restoreGit();
});

async function newWorld(remoteRecords?: number): Promise<BranchTipWorld> {
  const world = await buildBranchTipWorld(remoteRecords === undefined ? {} : { remoteRecords });
  worlds.push(world);
  return world;
}

function pending(world: BranchTipWorld) {
  return Effect.runPromise(
    Effect.provide(
      computeRecordsPending({
        records: world.dedicated,
        repoRoot: world.sourceRepo,
        publishRemote: PUBLISH_REMOTE,
        recordsClonePath: world.clonePath,
      }),
      LAYER,
    ),
  );
}

function runStatus(world: BranchTipWorld, json: boolean): string {
  const result = spawnSync("tsx", [mainTs, "records", "status", ...(json ? ["--json"] : [])], {
    cwd: world.sourceRepo,
    encoding: "utf8",
    env: phaxHomeEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

interface StatusJson {
  readonly branch: { state: string; localTip: string | null; remoteTip: string | null };
  readonly pending: number;
}

const short = (sha: string | null): string => (sha === null ? "none" : sha.slice(0, 7));

describe("phax records status reports the branch state", () => {
  // ac-status-states
  const states: readonly {
    state: string;
    remedy: string | null;
    prepare: (world: BranchTipWorld) => Promise<PreparedBranch>;
  }[] = [
    {
      state: "in-sync",
      remedy: null,
      prepare: async (world) => {
        const prepared = await putBranchAhead(world, { localOnly: 0 });
        return { ...prepared, localTip: prepared.remoteTip };
      },
    },
    {
      state: "ahead",
      remedy: "git -C",
      prepare: (world) => putBranchAhead(world, { localOnly: 2 }),
    },
    { state: "behind", remedy: "phax records sync", prepare: (world) => putBranchBehind(world) },
    {
      state: "diverged",
      remedy: "phax records sync --replay",
      prepare: (world) => putBranchDiverged(world),
    },
    {
      state: "unrelated",
      remedy: "phax records sync --replay",
      prepare: (world) => putBranchUnrelated(world),
    },
    {
      state: "no-local-branch",
      remedy: "phax records sync",
      prepare: async (world) => {
        const ahead = await putBranchAhead(world, { localOnly: 0 });
        git(["update-ref", "-d", BRANCH_REF], world.clonePath);
        return { ...ahead, localTip: null, localOnlyCommits: [] };
      },
    },
    {
      state: "no-remote-branch",
      remedy: null,
      prepare: async (world) => {
        git(["init", "-q", "-b", "main", world.clonePath], world.base);
        git(["config", "--local", "user.name", "Rita Recorder"], world.clonePath);
        git(["config", "--local", "user.email", "rita@records.test"], world.clonePath);
        git(["remote", "add", "origin", world.remoteUrl], world.clonePath);
        const commits = await world.writeRecords(
          { repo: world.clonePath, remote: "origin" },
          ["run-only-0001/phase-01"],
          "local",
        );
        return {
          repo: world.clonePath,
          remote: "origin",
          localTip: commits.at(-1) ?? null,
          remoteTip: null,
          localOnlyCommits: commits,
        };
      },
    },
  ];

  for (const { state, remedy, prepare } of states) {
    it(`reports ${state} with the full or null tips, and its remedy in the text`, async () => {
      const world = await newWorld();
      const prepared = await prepare(world);

      const reading = (JSON.parse(runStatus(world, true)) as StatusJson).branch;
      expect(reading).toEqual({
        state,
        localTip: prepared.localTip,
        remoteTip: prepared.remoteTip,
      });

      const text = runStatus(world, false);
      const line = text.split("\n").find((each) => each.startsWith("Records branch: "));
      expect(line).toContain(
        `(local ${short(prepared.localTip)}, origin ${short(prepared.remoteTip)})`,
      );
      if (remedy === null) expect(line).not.toContain("— run");
      else expect(line).toContain(`— run \`${remedy}`);
    });
  }

  it("names phax records sync, not 'all pushed', before anything was written or fetched", async () => {
    const world = await newWorld();

    const text = runStatus(world, false);

    expect(text).toContain(
      "Records branch: none here and none fetched from origin — run `phax records sync`",
    );
    expect(text).toContain("No record written here yet.");
    expect(text).not.toContain("All records are pushed");
  });

  // ac-status-pending
  it("counts only the local-only records of a diverged branch sharing 300 with the remote", async () => {
    const world = await newWorld(300);
    const diverged = await putBranchDiverged(world, { localOnly: 2, remoteNew: 1 });

    const status = await pending(world);

    expect(status.branch.state).toBe("diverged");
    expect(status.branch.localTip).toBe(diverged.localTip);
    expect(status.pending).toHaveLength(2);
    expect((JSON.parse(runStatus(world, true)) as StatusJson).pending).toBe(2);
  }, 240_000);
});

describe("a refused records push names the branch state and the fix", () => {
  // ac-push-message
  it("names the diverged state and phax records sync --replay, never a plain git push", async () => {
    const world = await newWorld();
    await putBranchAhead(world, { localOnly: 1 });
    // Another clone pushes after the last fetch: the clone's push is refused.
    await world.pushRemoteRecords(1);

    const result = await Effect.runPromise(
      Effect.provide(
        pushRecordsBranch({
          records: world.dedicated,
          repoRoot: world.sourceRepo,
          publishRemote: PUBLISH_REMOTE,
          recordsClonePath: world.clonePath,
        }),
        LAYER,
      ),
    );

    if (result.kind !== "failed") throw new Error(`expected a refused push, got ${result.kind}`);
    expect(result.branch?.state).toBe("diverged");

    const sentences = [
      describeRecordsPushFailure(result, "Records"),
      recordPushWarning(result),
      decisionRecordPushWarning(result),
      reviewRecordPushWarning(result),
    ];
    for (const sentence of sentences) {
      expect(sentence).toContain("refused");
      expect(sentence).toContain("diverged from origin");
      expect(sentence).toContain("`phax records sync --replay`");
      expect(sentence).not.toMatch(/git -C .* push/);
    }
    expect(sentences[0]).toMatch(/^Records push to origin refused: /);
    expect(sentences[1]).toMatch(/^authoring record push to origin refused: /);
    expect(sentences[2]).toMatch(/^decision record push to origin refused: /);
    expect(sentences[3]).toMatch(/^review entry push to origin refused: /);
  });

  it("names a behind branch with phax records sync", () => {
    const sentence = describeRecordsPushFailure(
      {
        remote: "origin",
        path: "/clone",
        message: "rejected",
        branch: { state: "behind", localTip: "a".repeat(40), remoteTip: "b".repeat(40) },
      },
      "Records",
    );
    expect(sentence).toBe(
      "Records push to origin refused: the records branch is behind origin (local aaaaaaa, origin bbbbbbb) — records remain pending; run `phax records sync`, then push.",
    );
  });

  it("keeps git's message and the git push remedy when the failure is not a branch disagreement", () => {
    const failure = {
      remote: "origin",
      path: "/clone",
      message: "network unreachable",
      branch: { state: "ahead", localTip: "a".repeat(40), remoteTip: "b".repeat(40) },
    } as const;
    expect(describeRecordsPushFailure(failure, "decision record")).toBe(
      "decision record not pushed to origin (network unreachable) — it stays pending (`phax records status` lists it); share it with `git -C /clone push origin phax/records/v1`",
    );
    expect(describeRecordsPushFailure({ ...failure, branch: null }, "Records")).toBe(
      "Records push to origin failed: network unreachable — records remain pending (see `phax records status`).",
    );
  });
});
