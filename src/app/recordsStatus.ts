import { Effect } from "effect";
import { Git, type GitError } from "../ports/git.js";
import type { RecordsDestination, ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import type { Registry } from "../schemas/registry.js";
import type { RecordsBranchReading } from "../domain/records/branchState.js";
import { readRecordsBranch, recordsBranchLocation } from "./recordsBranch.js";

export interface PendingRecordEntry {
  readonly runId: string;
  readonly phaseId: string;
}

export interface RecordsPendingStatus {
  readonly configured: boolean;
  readonly destination: RecordsDestination;
  /** The repo the records branch lives in: the source repo for in-repo, the local clone for a dedicated repo. */
  readonly localPath: string;
  /** The remote pending is measured against: `publish.remote` for in-repo, `origin` for a dedicated repo's clone. */
  readonly remote: string;
  readonly pending: readonly PendingRecordEntry[];
  /** The records branch's state against the remote tip phax last fetched. */
  readonly branch: RecordsBranchReading;
}

export interface RecordsPendingInput {
  readonly records: ResolvedRecordsConfig;
  readonly repoRoot: string;
  readonly publishRemote: string;
  readonly recordsClonePath?: string | undefined;
}

/**
 * Which record commits on `phax/records/v1` exist locally but not on the
 * configured remote: every commit reachable from the local tip and not from
 * the remote-tracking tip (all of the local history when the remote has no
 * branch), whatever the branch state — so on a diverged or unrelated branch
 * only the local-only records count. Purely derived from git state — no separate pending-state file to go stale
 * — so a run whose records were never pushed, or whose push failed, is still
 * reportable after the process that attempted it exits (spec §5.8). A
 * successful `git push` updates the local remote-tracking ref, so this
 * reflects the last confirmed push.
 */
export function computeRecordsPending(
  input: RecordsPendingInput,
): Effect.Effect<RecordsPendingStatus, GitError, Git> {
  return Effect.gen(function* () {
    if (!input.records.enabled) {
      return {
        configured: false,
        destination: input.records.destination,
        localPath: input.repoRoot,
        remote: "",
        pending: [],
        branch: { state: "in-sync", localTip: null, remoteTip: null },
      } as const;
    }

    const { repo: localPath, remote } = recordsBranchLocation(input);
    const branch = yield* readRecordsBranch(localPath, remote);
    const pending: PendingRecordEntry[] = [];
    if (branch.localTip !== null) {
      const git = yield* Git;
      const commits = yield* git.listCommitFiles(localPath, branch.localTip, branch.remoteTip);
      const seen = new Set<string>();
      for (const commit of commits) {
        for (const path of commit.paths) {
          const [runId, phaseId] = path.split("/");
          if (runId === undefined || phaseId === undefined) continue;
          const key = `${runId}/${phaseId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pending.push({ runId, phaseId });
        }
      }
    }

    return {
      configured: true,
      destination: input.records.destination,
      localPath,
      remote,
      pending,
      branch,
    } as const;
  });
}

/** Pending-record count per `runId`, for `phax ls`'s RECORDS column. */
export function pendingCountsByRunId(status: RecordsPendingStatus): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const entry of status.pending) {
    counts.set(entry.runId, (counts.get(entry.runId) ?? 0) + 1);
  }
  return counts;
}

export interface RecordsStatusRunEntry {
  readonly runId: string;
  readonly shortName: string;
  readonly namespace: string;
  readonly phaseIds: readonly string[];
}

/** Groups pending record entries by run, resolving each `runId` to its
 * `shortName`/`namespace` through the registry. A `runId` no longer present
 * in the registry (a pruned entry) falls back to displaying the raw id. */
export function groupPendingByRun(
  status: RecordsPendingStatus,
  registry: Registry,
): readonly RecordsStatusRunEntry[] {
  const phaseIdsByRun = new Map<string, string[]>();
  for (const entry of status.pending) {
    const phaseIds = phaseIdsByRun.get(entry.runId) ?? [];
    phaseIds.push(entry.phaseId);
    phaseIdsByRun.set(entry.runId, phaseIds);
  }

  const result: RecordsStatusRunEntry[] = [];
  for (const [runId, phaseIds] of phaseIdsByRun) {
    const registryEntry = registry.runs.find((r) => r.runId === runId);
    result.push({
      runId,
      shortName: registryEntry?.shortName ?? runId,
      namespace: registryEntry?.namespace ?? "",
      phaseIds: phaseIds.toSorted(),
    });
  }
  return result.toSorted((a, b) => a.shortName.localeCompare(b.shortName));
}
