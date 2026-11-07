import { Effect, Either } from "effect";
import { decodeBranchName, type BranchName } from "../domain/branded.js";
import {
  findReplayCollision,
  recordKeysOf,
  recordsSyncActionFor,
  type RecordsBranchState,
} from "../domain/records/branchState.js";
import type { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import { ORIGIN, RECORDS_BRANCH_NAME, readRecordsBranch } from "./recordsBranch.js";
import { reconcileRecordsSync } from "./recordsSync.js";

const RECORDS_BRANCH: BranchName = Either.getOrThrow(decodeBranchName(RECORDS_BRANCH_NAME));
const BRANCH_REF = `refs/heads/${RECORDS_BRANCH_NAME}`;

export interface RecordsBranchSyncInput {
  readonly records: ResolvedRecordsConfig;
  readonly stateRoot: string;
  readonly namespace: string;
  /** The source repository: the records branch lives here for an in-repo destination. */
  readonly repoRoot: string;
  /** `publish.remote`: the remote an in-repo destination's records branch is fetched from. */
  readonly publishRemote: string;
  /** Replay the local-only records onto the remote tip when the branch is diverged or unrelated. */
  readonly replay: boolean;
}

/** What `phax records sync` did to the local records branch. */
export type RecordsBranchOutcome =
  | { readonly kind: "created"; readonly tip: string; readonly records: number }
  | { readonly kind: "fast-forwarded"; readonly from: string; readonly to: string }
  | {
      readonly kind: "replayed";
      readonly count: number;
      readonly previousTip: string;
      readonly newTip: string;
      readonly remoteTip: string;
    }
  | {
      readonly kind: "unchanged";
      readonly state: RecordsBranchState;
      /** Local-only records, as `phax records status` counts them. */
      readonly pending: number;
    };

export type RecordsBranchSyncResult =
  | {
      readonly kind: "cloned" | "fetched";
      readonly path: string;
      readonly remote: string;
      readonly branch: RecordsBranchOutcome;
    }
  | {
      readonly kind: "refused";
      readonly reason: "origin-mismatch" | "local-only-history";
      readonly path: string;
      readonly remote: string;
      readonly message: string;
      readonly remedy: string;
    }
  | {
      readonly kind: "diverged";
      readonly reason: "diverged" | "unrelated";
      readonly path: string;
      readonly remote: string;
      readonly localTip: string;
      readonly remoteTip: string;
      readonly localOnly: number;
      readonly remedy: "phax records sync --replay";
    }
  | {
      readonly kind: "replay-collision";
      readonly path: string;
      readonly remote: string;
      readonly key: string;
      readonly localCommit: string;
      readonly remoteCommit: string;
    };

/**
 * Bring the records clone in line with its remote — clone or fetch the
 * dedicated clone, or fetch the one records branch of `publish.remote` into
 * the source repository — then align the local records branch with the
 * remote tip: create it, fast-forward it, or — with `replay` — replay the
 * local-only records onto the remote tip. Every ref move is a compare-and-swap;
 * nothing is pushed, merged or forced.
 */
export function syncRecordsBranch(
  input: RecordsBranchSyncInput,
): Effect.Effect<RecordsBranchSyncResult, GitError | FsError, Git | FileSystem> {
  return Effect.gen(function* () {
    const fetched = yield* fetchRecords(input);
    if (fetched.kind === "refused") return fetched;
    const { kind, path, remote, repo, remoteName } = fetched;
    const reading = yield* readRecordsBranch(repo, remoteName);
    const git = yield* Git;
    const localTip = reading.localTip ?? "";
    const remoteTip = reading.remoteTip;

    switch (recordsSyncActionFor(reading.state, input.replay)) {
      case "create": {
        const tip = remoteTip ?? "";
        yield* git.updateRef(repo, BRANCH_REF, tip, null);
        const records = (yield* git.listCommitFiles(repo, tip, null)).length;
        return { kind, path, remote, branch: { kind: "created", tip, records } };
      }
      case "fast-forward": {
        const to = remoteTip ?? "";
        yield* git.updateRef(repo, BRANCH_REF, to, localTip);
        return { kind, path, remote, branch: { kind: "fast-forwarded", from: localTip, to } };
      }
      case "none": {
        // Both tips missing classify as in-sync: there is nothing local to count.
        const pending =
          reading.localTip === null
            ? 0
            : (yield* git.listCommitFiles(repo, localTip, remoteTip)).length;
        return { kind, path, remote, branch: { kind: "unchanged", state: reading.state, pending } };
      }
      case "refuse": {
        const localOnly = (yield* git.listCommitFiles(repo, localTip, remoteTip)).length;
        return {
          kind: "diverged",
          reason: reading.state === "unrelated" ? "unrelated" : "diverged",
          path,
          remote,
          localTip,
          remoteTip: remoteTip ?? "",
          localOnly,
          remedy: "phax records sync --replay",
        };
      }
      case "replay": {
        const onto = remoteTip ?? "";
        const localOnly = keyed(yield* git.listCommitFiles(repo, localTip, onto));
        const remoteSide = keyed(yield* git.listCommitFiles(repo, onto, null));
        const collision = findReplayCollision(localOnly, remoteSide);
        if (collision !== null) return { kind: "replay-collision", path, remote, ...collision };
        // Every new commit is written before the branch moves, then it moves once.
        let newTip = onto;
        for (const commit of localOnly) newTip = yield* git.recommit(repo, commit.sha, newTip);
        yield* git.updateRef(repo, BRANCH_REF, newTip, localTip);
        return {
          kind,
          path,
          remote,
          branch: {
            kind: "replayed",
            count: localOnly.length,
            previousTip: localTip,
            newTip,
            remoteTip: onto,
          },
        };
      }
    }
  });
}

function keyed(
  commits: readonly { readonly sha: string; readonly paths: readonly string[] }[],
): readonly { readonly sha: string; readonly keys: readonly string[] }[] {
  return commits.map((commit) => ({ sha: commit.sha, keys: recordKeysOf(commit.paths) }));
}

type Fetched =
  | {
      readonly kind: "cloned" | "fetched";
      /** Where the records branch lives, as the answer names it. */
      readonly path: string;
      /** The remote as the answer names it: the URL of a dedicated clone, `publish.remote` in-repo. */
      readonly remote: string;
      /** The remote's name inside `path`, under which its tip is tracked. */
      readonly remoteName: string;
      readonly repo: string;
    }
  | Extract<RecordsBranchSyncResult, { readonly kind: "refused" }>;

/** Clone or fetch the dedicated clone, or fetch the in-repo records branch from `publish.remote`. */
function fetchRecords(
  input: RecordsBranchSyncInput,
): Effect.Effect<Fetched, GitError | FsError, Git | FileSystem> {
  return Effect.gen(function* () {
    if (input.records.destination.kind === "in-repo") {
      const git = yield* Git;
      // `absent` is not an error: the state then reads no-remote-branch.
      yield* git.fetchBranch(input.repoRoot, input.publishRemote, RECORDS_BRANCH);
      return {
        kind: "fetched",
        path: input.repoRoot,
        remote: input.publishRemote,
        remoteName: input.publishRemote,
        repo: input.repoRoot,
      } as const;
    }
    const sync = yield* reconcileRecordsSync({
      records: input.records,
      stateRoot: input.stateRoot,
      namespace: input.namespace,
    });
    switch (sync.kind) {
      case "refused":
        return sync;
      case "cloned":
      case "fetched":
        return { ...sync, remoteName: ORIGIN, repo: sync.path };
      case "nothing-to-bootstrap":
        // Only an in-repo destination answers this, and it is handled above.
        return yield* Effect.dieMessage(
          "reconcileRecordsSync: a dedicated clone had nothing to bootstrap",
        );
    }
  });
}
