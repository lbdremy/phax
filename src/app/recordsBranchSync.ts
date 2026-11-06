import type { Effect } from "effect";
import type { RecordsBranchState } from "../domain/records/branchState.js";
import type { FileSystem, FsError } from "../ports/fs.js";
import type { Git, GitError } from "../ports/git.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";

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
 * Bring the local records clone in line with its remote, then align the local
 * records branch with the remote tip: create it, fast-forward it, or — with
 * `replay` — replay the local-only records onto the remote tip. Not implemented
 * yet: the acceptance tests of `phax records sync` are frozen against this stub.
 */
export function syncRecordsBranch(
  _input: RecordsBranchSyncInput,
): Effect.Effect<RecordsBranchSyncResult, GitError | FsError, Git | FileSystem> {
  throw new Error("not implemented: syncRecordsBranch");
}
