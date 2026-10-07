import { Effect, Either } from "effect";
import { join } from "node:path";
import { UnsafeGitStateError } from "../domain/errors.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { readPhaseStatusFile, withSchemaUrl } from "../schemas/persisted.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import type { PhaseStatus } from "../schemas/status.js";
import type { PreparedPhaseBranch } from "./worktree.js";

function nowIso(): string {
  return new Date().toISOString();
}

function phaseDir(phaseId: string): string {
  return phaseId;
}

function writePhaseStatus(statusPath: string, status: PhaseStatus) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.writeAtomic(
      statusPath,
      JSON.stringify(withSchemaUrl("phase-status", status), null, 2),
    );
  });
}

/**
 * Ensure the phase folder and its `status.json` exist, noting the phase's
 * `base` whenever phax just created its branch:
 * - no status, branch created: write the initial status with that base;
 * - a status, branch created (re-created, e.g. after its deletion): replace
 *   the status's `base` and `branchName`, keep every other fact;
 * - a status, branch already there: keep the status untouched, its noted base
 *   stands;
 * - no status, branch already there: refuse, since phax never noted the commit
 *   that branch started from and never adopts it at its current tip.
 */
export function createPhaseFolder(
  runPath: string,
  phase: PhaxPlanPhase,
  phaseIndex: number,
  prepared: PreparedPhaseBranch,
  repoRoot: string,
): Effect.Effect<string, FsError | UnsafeGitStateError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const phasePath = join(runPath, phaseDir(phase.id));
    yield* fs.mkdirp(phasePath);

    const statusPath = join(phasePath, "status.json");
    if (yield* fs.exists(statusPath)) {
      // Idempotent: when resuming a rate-limited phase the folder already
      // exists. Preserve its status.json so the phase keeps its rate_limited/
      // worktree/session state instead of being reset to `pending`.
      if (prepared.kind === "existing") return phasePath;

      const raw = yield* fs.readText(statusPath);
      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: () => new FsError({ message: `${statusPath}: not valid JSON` }),
      });
      const decoded = readPhaseStatusFile(statusPath, parsed);
      if (Either.isLeft(decoded)) {
        return yield* Effect.fail(new FsError({ message: decoded.left.message }));
      }
      yield* writePhaseStatus(statusPath, {
        ...decoded.right,
        branchName: prepared.branch,
        base: prepared.base,
        updatedAt: nowIso(),
      });
      return phasePath;
    }

    if (prepared.kind === "existing") {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: `Phase branch "${prepared.branch}" already exists, but phase "${phase.id}" has no status.json, so the commit it started from is unknown to phax. Delete the branch (\`git branch -D ${prepared.branch}\`) and resume.`,
          repoPath: repoRoot,
        }),
      );
    }

    const now = nowIso();
    yield* writePhaseStatus(statusPath, {
      phaseId: phase.id,
      phaseIndex,
      state: "pending",
      model: phase.model,
      effort: phase.effort,
      branchName: prepared.branch,
      base: prepared.base,
      createdAt: now,
      updatedAt: now,
    });

    return phasePath;
  });
}
