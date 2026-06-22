import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Lock } from "../ports/lock.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  InvalidTransitionError,
  RegistryCorruptionError,
  LockConflictError,
  SetupCommandFailedError,
} from "../domain/errors.js";
import type { RunId, ShortName, WorktreePath } from "../domain/branded.js";
import { resolveRunByShortName } from "./resolveRunInfo.js";
import { patchAgentBindingStatus } from "./agentBinding.js";
import { setRunStatus } from "./registry.js";
import { dispatch } from "./dispatcher.js";
import { decodeRunStatus } from "../schemas/status.js";

export interface ArchiveOptions {
  force?: boolean;
}

export function archive(
  shortName: ShortName,
  stateRoot: string,
  repoRoot: string,
  opts: ArchiveOptions,
): Effect.Effect<
  void,
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError
  | ArchiveBlockedByDirtyWorktreeError
  | InvalidTransitionError
  | LockConflictError,
  FileSystem | Git | Shell | Lock | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const lock = yield* Lock;

    // 1. Refuse when lock is active
    const lockStatus = yield* lock.status(shortName);
    if (lockStatus.kind === "active") {
      return yield* Effect.fail(
        new LockConflictError({
          message: `Run "${shortName}" is locked by pid ${lockStatus.pid}. Release the lock first or use phax unlock.`,
          shortName,
          lockPath: join(stateRoot, "locks", `${shortName}.lock`),
          lockingPid: lockStatus.pid,
        }),
      );
    }

    // 2. Find the final worktree path from phase statuses
    const runPath = join(stateRoot, "runs", shortName);
    const infoResult = yield* Effect.sync(() => resolveRunByShortName(shortName, stateRoot));

    // Resolve namespace before dispatch (which moves the run folder).
    // Use infoResult when available (production); otherwise fall back to the
    // FileSystem port so the fake fs works in tests too.
    let namespace: string | undefined;
    if (Either.isRight(infoResult)) {
      namespace = infoResult.right.namespace;
    } else {
      namespace = yield* fs.readText(join(runPath, "run-status.json")).pipe(
        Effect.map((text) => {
          const raw = JSON.parse(text) as unknown;
          const decoded = decodeRunStatus(raw);
          return Either.isRight(decoded) ? decoded.right.namespace : undefined;
        }),
        Effect.catchAll(() => Effect.succeed(undefined as string | undefined)),
      );
    }

    const worktreePath =
      Either.isRight(infoResult) && infoResult.right.worktreePath
        ? (infoResult.right.worktreePath as WorktreePath)
        : undefined;

    // 3. Check final worktree cleanliness
    if (worktreePath) {
      const worktreeExists = yield* fs.exists(worktreePath);
      if (worktreeExists) {
        const isClean = yield* git.worktreeIsClean(worktreePath);
        if (!isClean && !opts.force) {
          return yield* Effect.fail(
            new ArchiveBlockedByDirtyWorktreeError({
              message: `Worktree at "${worktreePath}" has uncommitted changes. Commit or stash changes, or use --force.`,
              worktreePath,
            }),
          );
        }
      }
    }

    // Patch each phase binding to 'archived' before the folder is moved.
    // No-op when a phase has no binding (patchAgentBindingStatus catches internally).
    if (Either.isRight(infoResult)) {
      for (const phaseStatus of infoResult.right.phaseStatuses) {
        const phaseFolderPath = join(runPath, phaseStatus.phaseId);
        yield* Effect.promise(() => patchAgentBindingStatus(phaseFolderPath, "archived"));
      }
    }

    // 4. Dispatch RunArchiveRequested. The reducer is the source of truth for
    //    which run states allow archiving (review_open and completed); any
    //    other state comes back as a Rejected disposition and we surface that
    //    as an InvalidTransitionError. On Handled, the reducer emits
    //    MoveRunToArchive effects and the dispatcher persists run-status.json.
    //
    //    Both the run folder and the worktrees folder land under a single
    //    umbrella so a user can move the entire archive entry as one unit and
    //    the archivePath registry field stays unambiguous.
    const archivePath = join(stateRoot, "archive", shortName);
    const runsTo = join(archivePath, "runs");
    const worktreesFrom = join(stateRoot, "worktrees", shortName);
    const worktreesTo = join(archivePath, "worktrees");

    // Only include the worktrees pair when the source directory exists.
    const worktreesDirExists = yield* fs.exists(worktreesFrom);

    const result = yield* dispatch(
      {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        run: shortName as unknown as RunId,
        type: "RunArchiveRequested",
        from: runPath,
        to: runsTo,
        worktreesFrom: worktreesDirExists ? worktreesFrom : undefined,
        worktreesTo: worktreesDirExists ? worktreesTo : undefined,
      },
      { runPath, shortName: shortName as string },
    );
    if (result.disposition !== "Handled") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          from: result.stateBefore.run,
          to: "archived",
          entity: "run",
        }),
      );
    }

    // 5. Prune git's stale worktree admin records. This is safe to call even
    //    if no worktrees were moved — git worktree prune is a no-op when
    //    nothing is stale.
    yield* git.pruneWorktrees(repoRoot).pipe(Effect.ignore);

    // 6. Update registry index (run-status.json is already written by the
    //    dispatcher above; this call only refreshes the central registry.json).
    //    archivePath points at the umbrella directory, not the runs subfolder.
    if (namespace !== undefined) {
      yield* setRunStatus(stateRoot, namespace, shortName as string, {
        state: "archived",
        archivePath,
      });
    }
  });
}
