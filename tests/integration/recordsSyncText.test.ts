import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRANCH_REF,
  buildBranchTipWorld,
  git,
  putBranchBehind,
  putBranchUnrelated,
  type BranchTipOptions,
  type BranchTipWorld,
} from "../fixtures/records/branchTipRepos.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";

// What `phax records sync` prints in text mode (spec records-branch-tip §6): the fast-forward
// line names both tips, the refusal of a split branch prints its two normative lines, and a
// replay names the previous tip. Real git, a dedicated records clone, git isolated from the
// person's configuration.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");
const short = (sha: string): string => sha.slice(0, 7);

let restoreGit: () => void;
const worlds: BranchTipWorld[] = [];

beforeEach(() => {
  restoreGit = isolateGit();
});

afterEach(() => {
  for (const world of worlds.splice(0).toReversed()) world.cleanup();
  restoreGit();
});

async function newWorld(options?: BranchTipOptions): Promise<BranchTipWorld> {
  const world = await buildBranchTipWorld(options);
  worlds.push(world);
  return world;
}

function sync(world: BranchTipWorld, ...flags: string[]) {
  return spawnSync("tsx", [mainTs, "records", "sync", ...flags], {
    cwd: world.sourceRepo,
    encoding: "utf8",
    env: phaxHomeEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
}

const linesOf = (text: string): string[] => text.split("\n").filter((line) => line !== "");

describe("phax records sync prints what it did to the records branch", () => {
  it("names both tips when it fast-forwards a branch that is behind", async () => {
    const world = await newWorld({ remoteRecords: 3 });
    const behind = await putBranchBehind(world, { newRecords: 2 });
    const remoteTip = world.remoteTip();

    const result = sync(world);

    expect(result.status, result.stderr).toBe(0);
    expect(linesOf(result.stdout)).toEqual([
      `Fetched records into ${world.clonePath}`,
      `Records branch fast-forwarded ${short(behind.localTip!)} → ${short(remoteTip)}`,
    ]);
  });

  it("says nothing was replayed when --replay meets a branch that has not split", async () => {
    const world = await newWorld({ remoteRecords: 3 });
    await putBranchBehind(world, { newRecords: 1 });

    const result = sync(world, "--replay");

    expect(result.status, result.stderr).toBe(0);
    expect(linesOf(result.stdout).at(-1)).toBe(
      "Nothing to replay: the records branch has not split from its remote's",
    );
  });

  it("prints the two normative refusal lines for an unrelated branch, then the replay with the previous tip", async () => {
    const world = await newWorld();
    await putBranchUnrelated(world, { localOnly: 3 });
    const localTip = git(["rev-parse", BRANCH_REF], world.clonePath);
    const remoteTip = world.remoteTip();

    const refused = sync(world);

    expect(refused.status).toBe(1);
    expect(linesOf(refused.stdout)).toEqual([`Fetched records into ${world.clonePath}`]);
    expect(linesOf(refused.stderr)).toEqual([
      `✗ records branch is unrelated to origin's: local tip ${short(localTip)}, origin tip ${short(remoteTip)}, 3 local-only record(s)`,
      "  replay them onto origin's tip with `phax records sync --replay`",
    ]);

    const replayed = sync(world, "--replay");

    expect(replayed.status, replayed.stderr).toBe(0);
    const newTip = git(["rev-parse", BRANCH_REF], world.clonePath);
    expect(linesOf(replayed.stdout)).toEqual([
      `Fetched records into ${world.clonePath}`,
      `Replayed 3 record(s) onto origin's tip ${short(remoteTip)} → new tip ${short(newTip)} (previous tip ${short(localTip)})`,
      `Push them with the next record, or \`git -C ${world.clonePath} push origin phax/records/v1\``,
    ]);
  });
});
