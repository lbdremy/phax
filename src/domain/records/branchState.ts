/** The seven relations between the local records branch and its remote tip. */
export const RECORDS_BRANCH_STATES = [
  "in-sync",
  "ahead",
  "behind",
  "diverged",
  "unrelated",
  "no-local-branch",
  "no-remote-branch",
] as const;

export type RecordsBranchState = (typeof RECORDS_BRANCH_STATES)[number];

export interface RecordsBranchReading {
  readonly state: RecordsBranchState;
  readonly localTip: string | null;
  readonly remoteTip: string | null;
}

export function classifyRecordsBranch(input: {
  localTip: string | null;
  remoteTip: string | null;
  mergeBase: string | null;
}): RecordsBranchState {
  const { localTip, remoteTip, mergeBase } = input;
  if (localTip === null && remoteTip === null) return "in-sync";
  if (localTip === null) return "no-local-branch";
  if (remoteTip === null) return "no-remote-branch";
  if (localTip === remoteTip) return "in-sync";
  if (mergeBase === null) return "unrelated";
  if (mergeBase === remoteTip) return "ahead";
  if (mergeBase === localTip) return "behind";
  return "diverged";
}

/** The parent a new record commit takes, and the tip the ref update expects. */
export function recordParentFor(reading: RecordsBranchReading): {
  readonly parent: string | null;
  readonly expectedTip: string | null;
} {
  const catchUp = reading.state === "no-local-branch" || reading.state === "behind";
  return {
    parent: catchUp ? reading.remoteTip : reading.localTip,
    expectedTip: reading.localTip,
  };
}

export type RecordsSyncAction = "create" | "fast-forward" | "none" | "refuse" | "replay";

export function recordsSyncActionFor(
  state: RecordsBranchState,
  replay: boolean,
): RecordsSyncAction {
  switch (state) {
    case "no-local-branch":
      return "create";
    case "behind":
      return "fast-forward";
    case "diverged":
    case "unrelated":
      return replay ? "replay" : "refuse";
    default:
      return "none";
  }
}

export function recordsBranchRemedy(
  state: RecordsBranchState,
  where: { localPath: string; remote: string },
): string | null {
  switch (state) {
    case "behind":
    case "no-local-branch":
      return "phax records sync";
    case "diverged":
    case "unrelated":
      return "phax records sync --replay";
    case "ahead":
      return `git -C ${where.localPath} push ${where.remote} phax/records/v1`;
    default:
      return null;
  }
}

export function recordsBranchPhrase(state: RecordsBranchState, remote: string): string {
  switch (state) {
    case "in-sync":
      return `in sync with ${remote}`;
    case "ahead":
      return `ahead of ${remote}`;
    case "behind":
      return `behind ${remote}`;
    case "diverged":
      return `diverged from ${remote}'s`;
    case "unrelated":
      return `unrelated to ${remote}'s`;
    case "no-local-branch":
      return `missing locally (${remote} has one)`;
    case "no-remote-branch":
      return `not on ${remote} yet`;
  }
}

const RECORD_SUFFIX = "/record.json";

export function recordKeysOf(paths: readonly string[]): readonly string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path.endsWith(RECORD_SUFFIX)) continue;
    const key = path.slice(0, -RECORD_SUFFIX.length);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

interface CommitKeys {
  readonly sha: string;
  readonly keys: readonly string[];
}

export function findReplayCollision(
  localOnly: readonly CommitKeys[],
  remote: readonly CommitKeys[],
): { key: string; localCommit: string; remoteCommit: string } | null {
  const remoteByKey = new Map<string, string>();
  for (const commit of remote) {
    for (const key of commit.keys) if (!remoteByKey.has(key)) remoteByKey.set(key, commit.sha);
  }
  for (const commit of localOnly) {
    for (const key of commit.keys) {
      const remoteCommit = remoteByKey.get(key);
      if (remoteCommit !== undefined) return { key, localCommit: commit.sha, remoteCommit };
    }
  }
  return null;
}
