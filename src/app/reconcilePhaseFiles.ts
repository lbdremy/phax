import { Effect } from "effect";
import { join } from "node:path";
import type { RunId, WorktreePath } from "../domain/branded.js";
import { reconcile } from "../domain/reconciliation/reconcile.js";
import { renderReconciliationMarkdown } from "../domain/reconciliation/render.js";
import type { PlannedFiles } from "../domain/reconciliation/types.js";
import { makeArtifactGeneratedTelemetryEvent } from "../domain/telemetry/events.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";

export interface ReconcilePhaseFilesOptions {
  readonly phase: PhaxPlanPhase;
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly runId: string;
}

export function reconcilePhaseFiles(
  opts: ReconcilePhaseFilesOptions,
): Effect.Effect<void, GitError | FsError, Git | FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;
    const telemetry = yield* SystemTelemetry;

    const planned: PlannedFiles = {
      create: opts.phase.plannedFilesToCreate,
      edit: opts.phase.plannedFilesToEdit,
      optional: opts.phase.optionalFilesToEdit,
    };

    const entries = yield* git.diffNameStatus(opts.worktreePath);
    const result = reconcile(planned, entries);
    const markdown = renderReconciliationMarkdown(result, planned);

    yield* fs.writeAtomic(
      join(opts.phaseFolderPath, "file-reconciliation.json"),
      JSON.stringify(result, null, 2),
    );
    yield* fs.writeAtomic(join(opts.phaseFolderPath, "file-reconciliation.md"), markdown);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId: opts.runId as RunId,
        operationId: opts.phase.id,
        artifact: "file-reconciliation",
        path: join(opts.phase.id, "file-reconciliation.md"),
      }),
    );
  });
}
