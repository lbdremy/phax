import { Effect } from "effect";
import { join } from "node:path";
import type { RunId, WorktreePath } from "../domain/branded.js";
import { reconcile } from "../domain/reconciliation/reconcile.js";
import { renderReconciliationMarkdown } from "../domain/reconciliation/render.js";
import type { PlannedFiles, ReconciliationResult } from "../domain/reconciliation/types.js";
import { makeArtifactGeneratedTelemetryEvent } from "../domain/telemetry/events.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { encodePhaseFileReconciliation } from "../schemas/reconciliation.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";

export interface ReconcilePhaseFilesOptions {
  readonly phase: PhaxPlanPhase;
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly runId: string;
  readonly fileReconciliationMode: "report_only" | "warn";
}

export function reconcilePhaseFiles(
  opts: ReconcilePhaseFilesOptions,
): Effect.Effect<ReconciliationResult, GitError | FsError, Git | FileSystem | SystemTelemetry> {
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

    if (opts.fileReconciliationMode === "warn" && result.hasDeviations) {
      const deviationSummary = [
        result.missingPlannedCreate.length > 0
          ? `missing planned creates: ${result.missingPlannedCreate.join(", ")}`
          : null,
        result.missingPlannedEdit.length > 0
          ? `missing planned edits: ${result.missingPlannedEdit.join(", ")}`
          : null,
        result.unplannedCreated.length > 0
          ? `unplanned creates: ${result.unplannedCreated.join(", ")}`
          : null,
        result.unplannedEdited.length > 0
          ? `unplanned edits: ${result.unplannedEdited.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      yield* Effect.logWarning(
        `[phax] File reconciliation deviation in ${opts.phase.id}: ${deviationSummary}`,
      );
    }

    const persisted = encodePhaseFileReconciliation({ ...result, phaseId: opts.phase.id });
    yield* fs.writeAtomic(
      join(opts.phaseFolderPath, "file-reconciliation.json"),
      JSON.stringify(persisted, null, 2),
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

    return result;
  });
}
