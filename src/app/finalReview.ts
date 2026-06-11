import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PhaseId, RunId } from "../domain/branded.js";
import type { RegistryCorruptionError, SetupCommandFailedError } from "../domain/errors.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { dispatch } from "./dispatcher.js";

/**
 * Open final review by dispatching `FinalReviewOpened` through the state
 * machine. The reducer transitions the run and final phase to `review_open`
 * and emits a single `OpenRunReview` effect; the effect runner runs
 * `generateReviewHandoff` (which writes `review-handoff.md`, `final-report.md`,
 * and the global reconciliation artifacts) and only then flips the registry to
 * `review_open`. A generation failure leaves the run in its prior state.
 */
export function openFinalReview(
  info: RunReviewInfo,
): Effect.Effect<
  void,
  FsError | GitError | ShellError | SetupCommandFailedError | RegistryCorruptionError,
  FileSystem | Git | Shell | SystemTelemetry
> {
  return dispatch(
    {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: info.shortName as RunId,
      phase: info.finalPhaseId as PhaseId,
      type: "FinalReviewOpened",
      info,
    },
    {
      runPath: info.runPath,
      shortName: info.shortName,
      phaseFolderPath: join(info.runPath, info.finalPhaseId),
      phaseId: info.finalPhaseId,
    },
  ).pipe(Effect.asVoid);
}
