import { Effect } from "effect";
import { Git, type GitError } from "../ports/git.js";
import type { RecordsDestination, ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import type { Registry } from "../schemas/registry.js";
import { RECORDS_BRANCH_NAME } from "./writeRecord.js";
import { ORIGIN } from "./recordsSync.js";

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
}

export interface RecordsPendingInput {
  readonly records: ResolvedRecordsConfig;
  readonly repoRoot: string;
  readonly publishRemote: string;
  readonly recordsClonePath?: string | undefined;
}

// Defensive cap on the parent walk below — a shared records branch realistically
// holds nowhere near this many commits between two pushes; this only guards
// against spinning forever on a corrupt or wildly misconfigured ref.
const MAX_PENDING_WALK = 10_000;

/**
 * Which record commits on `phax/records/v1` exist locally but not on the
 * configured remote. Each record commit's tree holds only that one write's
 * own files (spec §5.3's plumbing builds a fresh tree per commit, not a
 * cumulative one) — so this walks the first-parent chain from the local tip
 * back to (excluding) the remote-tracking tip, collecting every visited
 * commit's own tree, rather than diffing the two tips' trees directly.
 * Purely derived from git state — no separate pending-state file to go stale
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
      } as const;
    }

    const isInRepo = input.records.destination.kind === "in-repo";
    const localPath = isInRepo ? input.repoRoot : (input.recordsClonePath ?? input.repoRoot);
    const remote = isInRepo ? input.publishRemote : ORIGIN;

    const git = yield* Git;
    const localTip = yield* git.resolveRef(localPath, `refs/heads/${RECORDS_BRANCH_NAME}`);
    if (localTip === null) {
      return {
        configured: true,
        destination: input.records.destination,
        localPath,
        remote,
        pending: [],
      } as const;
    }

    const remoteTip = yield* git.resolveRef(
      localPath,
      `refs/remotes/${remote}/${RECORDS_BRANCH_NAME}`,
    );

    const seen = new Set<string>();
    const pending: PendingRecordEntry[] = [];
    let cursor: string | null = localTip;
    let steps = 0;
    while (cursor !== null && cursor !== remoteTip && steps < MAX_PENDING_WALK) {
      steps++;
      const entries = yield* git.readTree(localPath, cursor);
      for (const entry of entries) {
        if (entry.type !== "blob") continue;
        const [runId, phaseId] = entry.path.split("/");
        if (runId === undefined || phaseId === undefined) continue;
        const key = `${runId}/${phaseId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pending.push({ runId, phaseId });
      }
      cursor = yield* git.resolveRef(localPath, `${cursor}^`);
    }

    return {
      configured: true,
      destination: input.records.destination,
      localPath,
      remote,
      pending,
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
