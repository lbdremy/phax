import { Effect } from "effect";
import { join } from "node:path";
import type { RunId, WorktreePath } from "../domain/branded.js";
import { reconcile, reconcileReview } from "../domain/reconciliation/reconcile.js";
import { renderReconciliationMarkdown } from "../domain/reconciliation/render.js";
import type { PlannedFiles, ReconciliationResult } from "../domain/reconciliation/types.js";
import { makeArtifactGeneratedTelemetryEvent } from "../domain/telemetry/events.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { withSchemaUrl } from "../schemas/persisted.js";
import { encodePhaseFileReconciliationFile } from "../schemas/reconciliation.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";

export interface ReconcilePhaseFilesOptions {
  readonly phase: PhaxPlanPhase;
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly runId: string;
  readonly fileReconciliationMode: "report_only" | "warn";
  /** The oracle files the phase discharges (`dischargedOracleFiles`), counted
   *  as optional files: removing a marker is never an unplanned edit, and an
   *  untouched oracle file is never a missing edit. */
  readonly oracleFiles: readonly string[];
  /** `agent` (the default): the phase's commit against its planned files.
   *  `review`: a closed interactive stop's commit, every changed file a
   *  review correction (`reconcileReview`). */
  readonly kind?: "agent" | "review" | undefined;
  /** `phase` (the default): `file-reconciliation.json` and `.md`. `correction`:
   *  a held stop's review commit, written to `correction-reconciliation.json`
   *  and `.md` beside the phase's own, which stay as they are. */
  readonly output?: "phase" | "correction" | undefined;
}

type WriteReconciliationOptions = Omit<ReconcilePhaseFilesOptions, "kind">;

const outputBase = (output: ReconcilePhaseFilesOptions["output"]): string =>
  output === "correction" ? "correction-reconciliation" : "file-reconciliation";

const plannedFilesOf = (opts: WriteReconciliationOptions): PlannedFiles => ({
  create: opts.phase.plannedFilesToCreate,
  edit: opts.phase.plannedFilesToEdit,
  optional: [...new Set([...opts.phase.optionalFilesToEdit, ...opts.oracleFiles])],
});

export function reconcilePhaseFiles(
  opts: ReconcilePhaseFilesOptions,
): Effect.Effect<ReconciliationResult, GitError | FsError, Git | FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const entries = yield* git.diffNameStatus(opts.worktreePath);
    const result =
      opts.kind === "review" ? reconcileReview(entries) : reconcile(plannedFilesOf(opts), entries);
    yield* writeReconciliation(opts, result);
    return result;
  });
}

/**
 * A held stop closed without change: the empty review reconciliation, written
 * to the correction files with no git read, as there is no review commit.
 */
export function writeUnchangedCorrectionReconciliation(
  opts: Omit<WriteReconciliationOptions, "output">,
): Effect.Effect<ReconciliationResult, FsError, FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const result = reconcileReview([]);
    yield* writeReconciliation({ ...opts, output: "correction" }, result);
    return result;
  });
}

function writeReconciliation(
  opts: WriteReconciliationOptions,
  result: ReconciliationResult,
): Effect.Effect<void, FsError, FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const telemetry = yield* SystemTelemetry;
    const planned = plannedFilesOf(opts);
    const markdown = renderReconciliationMarkdown(result, planned);
    const base = outputBase(opts.output);

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

    const persisted = encodePhaseFileReconciliationFile(
      withSchemaUrl("phase-file-reconciliation", { ...result, phaseId: opts.phase.id }),
    );
    yield* fs.writeAtomic(
      join(opts.phaseFolderPath, `${base}.json`),
      JSON.stringify(persisted, null, 2),
    );
    yield* fs.writeAtomic(join(opts.phaseFolderPath, `${base}.md`), markdown);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId: opts.runId as RunId,
        operationId: opts.phase.id,
        artifact: base,
        path: join(opts.phase.id, `${base}.md`),
      }),
    );
  });
}
