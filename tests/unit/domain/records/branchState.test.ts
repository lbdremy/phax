import { describe, expect, it } from "vitest";
import {
  classifyRecordsBranch,
  findReplayCollision,
  recordKeysOf,
  recordParentFor,
  recordsBranchPhrase,
  recordsBranchRemedy,
  recordsSyncActionFor,
  RECORDS_BRANCH_STATES,
  type RecordsBranchState,
} from "../../../../src/domain/records/branchState.js";

describe("classifyRecordsBranch", () => {
  const rows: ReadonlyArray<
    [string, string | null, string | null, string | null, RecordsBranchState]
  > = [
    ["both missing", null, null, null, "in-sync"],
    ["equal tips", "a", "a", "a", "in-sync"],
    ["ahead", "b", "a", "a", "ahead"],
    ["behind", "a", "b", "a", "behind"],
    ["diverged", "b", "c", "a", "diverged"],
    ["unrelated", "b", "c", null, "unrelated"],
    ["no local", null, "a", null, "no-local-branch"],
    ["no remote", "a", null, null, "no-remote-branch"],
  ];
  it.each(rows)("%s", (_name, localTip, remoteTip, mergeBase, state) => {
    expect(classifyRecordsBranch({ localTip, remoteTip, mergeBase })).toBe(state);
  });
});

describe("per-state rules", () => {
  const rows: ReadonlyArray<
    [RecordsBranchState, string | null, string | null, string, string, string | null]
  > = [
    ["in-sync", "L", "R", "L", "none", null],
    ["ahead", "L", "R", "L", "none", "git -C /p push origin phax/records/v1"],
    ["behind", "L", "R", "R", "fast-forward", "phax records sync"],
    ["diverged", "L", "R", "L", "refuse", "phax records sync --replay"],
    ["unrelated", "L", "R", "L", "refuse", "phax records sync --replay"],
    ["no-local-branch", null, "R", "R", "create", "phax records sync"],
    ["no-remote-branch", "L", null, "L", "none", null],
  ];
  it.each(rows)("%s", (state, localTip, remoteTip, parent, action, remedy) => {
    expect(recordParentFor({ state, localTip, remoteTip })).toEqual({
      parent,
      expectedTip: localTip,
    });
    expect(recordsSyncActionFor(state, false)).toBe(action);
    expect(recordsBranchRemedy(state, { localPath: "/p", remote: "origin" })).toBe(remedy);
  });

  it("orphan first write has a null parent", () => {
    expect(recordParentFor({ state: "in-sync", localTip: null, remoteTip: null })).toEqual({
      parent: null,
      expectedTip: null,
    });
  });

  it("replays only diverged and unrelated", () => {
    for (const state of RECORDS_BRANCH_STATES) {
      if (state === "diverged" || state === "unrelated") {
        expect(recordsSyncActionFor(state, true)).toBe("replay");
      } else {
        expect(recordsSyncActionFor(state, true)).toBe(recordsSyncActionFor(state, false));
      }
    }
  });

  it("phrases", () => {
    expect(RECORDS_BRANCH_STATES.map((s) => recordsBranchPhrase(s, "origin"))).toEqual([
      "in sync with origin",
      "ahead of origin",
      "behind origin",
      "diverged from origin's",
      "unrelated to origin's",
      "missing locally (origin has one)",
      "not on origin yet",
    ]);
  });
});

describe("record keys and collisions", () => {
  it("reads keys from record.json paths", () => {
    expect(
      recordKeysOf(["a/b/record.json", "a/b/other.md", "c/record.json", "a/b/record.json"]),
    ).toEqual(["a/b", "c"]);
  });

  it("finds the oldest local commit's shared key", () => {
    expect(
      findReplayCollision(
        [
          { sha: "l1", keys: ["x"] },
          { sha: "l2", keys: ["y", "z"] },
        ],
        [{ sha: "r1", keys: ["z", "y"] }],
      ),
    ).toEqual({ key: "y", localCommit: "l2", remoteCommit: "r1" });
    expect(
      findReplayCollision([{ sha: "l1", keys: ["x"] }], [{ sha: "r1", keys: ["y"] }]),
    ).toBeNull();
  });
});
