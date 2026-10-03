/**
 * The prune use case: delete archived runs of the current namespace for real.
 *
 * Prune does not go through `dispatch` or the RunState machine. An archived
 * run is already in its last state; prune deletes it rather than
 * transitioning it, after re-checking `state: archived` from the registry.
 *
 * Before anything is deleted, the whole command is refused when a named run is
 * unknown, not archived or in another namespace (PruneRefusedError), or when a
 * selected run holds an active lock (LockConflictError). The git facts are
 * gathered once, each run is planned (prune, or keep), and the plan goes to
 * `onPreview` before any confirmation is asked.
 *
 * Deletion order per run: the archive folder, then the worktree metadata, then
 * the local branches (`git branch -D`), and the registry entry last — so the
 * name stays held until every other part is gone. An absent part counts as
 * removed. The first part that cannot be removed stops that run, which is kept
 * with reason `removal-failed`; the next run proceeds. A re-run finishes it.
 *
 * Prune never touches remote refs, tags, `phax/records/v1` or any branch
 * outside the selected runs' expected branches, and never contacts a remote.
 */
import { Data, Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Lock } from "../ports/lock.js";
import { Prompt, type PromptError } from "../ports/prompt.js";
import type { BranchName, WorktreePath } from "../domain/branded.js";
import {
  LockConflictError,
  PruneRefusedError,
  type RegistryCorruptionError,
} from "../domain/errors.js";
import {
  decideRun,
  describePruneRefusal,
  expectedRunBranches,
  formatBytes,
  isUnderRoot,
  makePrunePlan,
  pruneTotals,
  remoteTrackingRefsFor,
  runOwnedWorktreeRoots,
  selectPruneRuns,
  type PruneConfirmation,
  type PrunePart,
  type PrunePlan,
  type PrunePlannedRun,
  type PruneResult,
  type PruneRunReport,
  type PruneSelection,
  type UnpreservedBranch,
} from "../domain/prune.js";
import { runKey } from "../domain/runRef.js";
import { readRegistry, removeRun } from "./registry.js";

export type { PruneResult } from "../domain/prune.js";

export interface PruneInput {
  readonly namespace: string;
  readonly stateRoot: string;
  readonly repoRoot: string;
  readonly selection: PruneSelection;
  readonly force: boolean;
  readonly confirmation: PruneConfirmation;
  /** Called once with the plan, before any confirmation or deletion. */
  readonly onPreview: (plan: PrunePlan) => Effect.Effect<void>;
}

const HEADS = "refs/heads/";

function shortHeads(refs: readonly string[]): readonly string[] {
  return refs.filter((ref) => ref.startsWith(HEADS)).map((ref) => ref.slice(HEADS.length));
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? "";
}

/** A removal step that failed, carrying the part it addressed. Internal to the apply loop. */
class RemovalFailed extends Data.TaggedError("RemovalFailed")<{
  part: PrunePart;
  message: string;
}> {}

function removing<A, R>(
  part: PrunePart,
  effect: Effect.Effect<A, FsError | GitError | RegistryCorruptionError, R>,
): Effect.Effect<A, RemovalFailed, R> {
  return Effect.mapError(
    effect,
    (error) => new RemovalFailed({ part, message: firstLine(error.message) }),
  );
}

export function prune(
  input: PruneInput,
): Effect.Effect<
  PruneResult,
  | PruneRefusedError
  | LockConflictError
  | FsError
  | GitError
  | RegistryCorruptionError
  | PromptError,
  FileSystem | Git | Lock | Prompt
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const lock = yield* Lock;
    const prompt = yield* Prompt;
    const { namespace, stateRoot, repoRoot } = input;

    // 1. Select, then refuse the whole command before deleting anything.
    const registry = yield* readRegistry(stateRoot);
    const selected = selectPruneRuns(registry.runs, namespace, input.selection);
    if (Either.isLeft(selected)) {
      return yield* Effect.fail(
        new PruneRefusedError({
          message: selected.left.map(describePruneRefusal).join("\n"),
          refusals: selected.left,
        }),
      );
    }
    const entries = selected.right;
    if (entries.length === 0) return { kind: "nothing-to-prune" } as const;

    const locked: { key: string; shortName: string; pid: number }[] = [];
    for (const entry of entries) {
      const key = runKey(entry.namespace, entry.shortName);
      const status = yield* lock.status(key);
      if (status.kind === "active") {
        locked.push({ key, shortName: entry.shortName, pid: status.pid });
      }
    }
    const [firstLocked] = locked;
    if (firstLocked !== undefined) {
      return yield* Effect.fail(
        new LockConflictError({
          message: locked
            .map(
              (l) =>
                `Run "${l.key}" is locked by pid ${l.pid}; release the lock first: phax unlock ${l.shortName}`,
            )
            .join("\n"),
          shortName: firstLocked.key,
          lockPath: join(stateRoot, "locks", `${firstLocked.key}.lock`),
          lockingPid: firstLocked.pid,
        }),
      );
    }

    // 2. Gather the facts once and plan every run.
    const localBranches = shortHeads(yield* git.listRefs(repoRoot, HEADS));
    const localSet = new Set(localBranches);
    const remoteRefs = yield* git.listRefs(repoRoot, "refs/remotes/");
    const worktrees = yield* git.listWorktrees(repoRoot);

    const gathered: {
      entry: (typeof entries)[number];
      archivePath: string;
      archiveBytes: number;
      expected: readonly BranchName[];
      present: readonly BranchName[];
    }[] = [];
    for (const entry of entries) {
      const archivePath =
        entry.archivePath ?? join(stateRoot, "archive", runKey(entry.namespace, entry.shortName));
      const archiveBytes = yield* fs.apparentSize(archivePath);
      const expected = expectedRunBranches(entry, localBranches);
      const present = expected.filter((branch) => localSet.has(branch));
      gathered.push({ entry, archivePath, archiveBytes, expected, present });
    }
    // Neither a run's own branches nor another selected run's preserve its commits.
    const deleting = Array.from(new Set(gathered.flatMap((run) => run.present)));

    const planned: PrunePlannedRun[] = [];
    for (const run of gathered) {
      const unpreserved: UnpreservedBranch[] = [];
      for (const branch of run.present) {
        const unpreservedCommits = yield* git.countUnpreservedCommits(repoRoot, branch, deleting);
        unpreserved.push({ branch, unpreservedCommits });
      }
      planned.push(
        decideRun(
          {
            entry: run.entry,
            archivePath: run.archivePath,
            archiveBytes: run.archiveBytes,
            expectedBranches: run.expected,
            presentBranches: run.present,
            unpreserved,
            worktrees,
            ownedWorktreeRoots: runOwnedWorktreeRoots(
              stateRoot,
              run.entry.namespace,
              run.entry.shortName,
              run.archivePath,
            ),
            remoteBranchesKept: remoteTrackingRefsFor(run.expected, remoteRefs),
          },
          input.force,
        ),
      );
    }
    const plan = makePrunePlan(namespace, planned);
    yield* input.onPreview(plan);

    // 3. Confirm.
    if (input.confirmation === "dry-run") return { kind: "previewed", plan } as const;
    if (input.confirmation === "missing") return { kind: "confirmation-missing", plan } as const;
    if (input.confirmation === "prompt" && plan.totals.pruned > 0) {
      const confirmed = yield* prompt
        .confirm({
          message: `Prune ${plan.totals.pruned} run(s), freeing ${formatBytes(plan.totals.bytesFreed)}?`,
          initialValue: false,
        })
        .pipe(Effect.catchTag("PromptCancelled", () => Effect.succeed(false)));
      if (!confirmed) return { kind: "declined", plan } as const;
    }

    // 4. Apply, run by run, in plan order.
    const reports: PruneRunReport[] = [];
    for (const run of plan.runs) {
      const base = {
        qualifiedName: run.qualifiedName,
        shortName: run.shortName,
        runId: run.runId,
        archiveBytes: run.archiveBytes,
        remoteBranchesKept: run.remoteBranchesKept,
      };
      if (run.outcome === "would-keep") {
        reports.push({
          ...base,
          outcome: "kept",
          bytesFreed: 0,
          branchesDeleted: [],
          branchesDiscarded: [],
          alreadyAbsent: [],
          kept: run.kept,
        });
        continue;
      }

      const alreadyAbsent: PrunePart[] = [];
      const branchesDeleted: BranchName[] = [];
      let bytesFreed = 0;
      const applied = yield* Effect.gen(function* () {
        // (a) The archive folder.
        const folderExists = yield* removing("archive folder", fs.exists(run.archivePath));
        if (folderExists) {
          yield* removing("archive folder", fs.remove(run.archivePath));
          bytesFreed = run.archiveBytes;
        } else {
          alreadyAbsent.push("archive folder");
        }

        // (b) The worktree metadata.
        const isOwned = (path: string) => run.ownedWorktreeRoots.some((r) => isUnderRoot(path, r));
        const before = yield* removing("worktree metadata", git.listWorktrees(repoRoot));
        if (!before.some((worktree) => isOwned(worktree.path))) {
          alreadyAbsent.push("worktree metadata");
        } else {
          yield* removing("worktree metadata", git.pruneWorktrees(repoRoot));
          const after = yield* removing("worktree metadata", git.listWorktrees(repoRoot));
          for (const worktree of after.filter((w) => isOwned(w.path))) {
            yield* removing(
              "worktree metadata",
              git.removeWorktree(worktree.path as WorktreePath, true, repoRoot),
            );
          }
        }

        // (c) The local branches.
        const heads = new Set(
          shortHeads(yield* removing("local branches", git.listRefs(repoRoot, HEADS))),
        );
        for (const branch of run.expectedBranches) {
          if (!heads.has(branch)) {
            alreadyAbsent.push(`branch ${branch}`);
            continue;
          }
          yield* removing(`branch ${branch}`, git.deleteBranch(branch, true, repoRoot));
          branchesDeleted.push(branch);
        }

        // (d) The registry entry, last.
        yield* removing("registry entry", removeRun(stateRoot, namespace, run.shortName));
      }).pipe(
        Effect.as(null),
        Effect.catchTag("RemovalFailed", (failure) => Effect.succeed(failure)),
      );

      reports.push({
        ...base,
        outcome: applied === null ? "pruned" : "kept",
        bytesFreed,
        branchesDeleted,
        branchesDiscarded: run.branchesDiscarded.filter((b) => branchesDeleted.includes(b.branch)),
        alreadyAbsent,
        kept:
          applied === null
            ? null
            : { reason: "removal-failed", part: applied.part, message: applied.message },
      });
    }

    return {
      kind: "applied",
      plan,
      report: { runs: reports, totals: pruneTotals(reports) },
    } as const;
  });
}
