import { Effect, Either } from "effect";
import { join } from "node:path";
import { ReviewHandoffArtifactMissingError } from "../domain/errors.js";
import {
  aggregateGlobalReconciliation,
  renderGlobalReconciliationMarkdown,
  type GlobalFileReconciliation,
} from "../domain/reconciliation/global.js";
import { parseReportName } from "../domain/gate/reportPath.js";
import { gatherReviewNotes, renderReviewNotes } from "../domain/review/reviewNotes.js";
import { runKey } from "../domain/runRef.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { ReviewNote } from "../schemas/gateReport.js";
import { readGateReport, readPhaseFileReconciliationFile } from "../schemas/persisted.js";
import { SOURCE_SPEC_OUTCOME_FILENAME } from "./completeRunArtifacts.js";

export interface PhaseContent {
  readonly phaseId: string;
  readonly title: string;
  readonly fileReconciliationMd: string;
  readonly phaseHandoffMd: string;
}

export interface LoadPhaseContentsResult {
  readonly phaseContents: readonly PhaseContent[];
  readonly missingPhases: readonly string[];
  readonly missingPaths: readonly string[];
}

export interface ReviewHandoffInputs {
  readonly global: GlobalFileReconciliation;
  readonly globalMd: string;
  readonly phaseContents: readonly PhaseContent[];
  // The run folder's source-spec-outcome.md, when run completion wrote one.
  readonly sourceSpecOutcomeMd: string | undefined;
  // The `## Review notes` section, when a phase's last gate attempt left a note.
  readonly reviewNotesMd: string | undefined;
}

// Reads the source-spec outcome run completion left in the run folder, or
// undefined when the plan had no spec outcome to state (no fragment written).
export function loadSourceSpecOutcome(
  info: RunReviewInfo,
): Effect.Effect<string | undefined, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(info.runPath, SOURCE_SPEC_OUTCOME_FILENAME);
    if (!(yield* fs.exists(path))) {
      return undefined;
    }
    return yield* fs.readText(path);
  });
}

// The review notes of one phase's last gate attempt (the highest
// `checks-attempt-NN.log`): those of every checked report of that attempt, in
// step order. A missing, unreadable or refused report contributes nothing,
// and earlier attempts are never read.
function loadLastAttemptReviewNotes(
  phaseFolderPath: string,
): Effect.Effect<readonly ReviewNote[], never, FileSystem> {
  const none: readonly ReviewNote[] = [];
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(phaseFolderPath))) return none;
    const names = yield* fs.list(phaseFolderPath);
    let lastAttempt = 0;
    for (const name of names) {
      const match = /^checks-attempt-(\d{2,})\.log$/.exec(name);
      if (match !== null) lastAttempt = Math.max(lastAttempt, Number(match[1]));
    }
    if (lastAttempt === 0) return none;
    const reports = names
      .flatMap((name) => {
        const parsed = parseReportName(name);
        return parsed?.attempt === lastAttempt ? [{ name, step: parsed.step }] : [];
      })
      .toSorted((a, b) => a.step - b.step);
    const notes: ReviewNote[] = [];
    for (const { name } of reports) {
      notes.push(...(yield* readCheckedReviewNotes(join(phaseFolderPath, name))));
    }
    return notes;
  }).pipe(Effect.orElseSucceed(() => none));
}

function readCheckedReviewNotes(
  path: string,
): Effect.Effect<readonly ReviewNote[], never, FileSystem> {
  const none: readonly ReviewNote[] = [];
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    const read = readGateReport(parsed);
    if (Either.isLeft(read) || read.right.outcome !== "checked") return none;
    return read.right.review;
  }).pipe(Effect.orElseSucceed(() => none));
}

// The review handoff's `## Review notes` section, gathered from each phase's
// last gate attempt, or undefined when no phase left a note.
export function loadReviewNotes(
  info: RunReviewInfo,
): Effect.Effect<string | undefined, never, FileSystem> {
  return Effect.gen(function* () {
    const phaseIds = info.phaseStatuses
      .toSorted((a, b) => a.phaseIndex - b.phaseIndex)
      .map((p) => p.phaseId);
    const phases = [];
    for (const phaseId of phaseIds) {
      const notes = yield* loadLastAttemptReviewNotes(join(info.runPath, phaseId));
      phases.push({ phaseId, notes });
    }
    return renderReviewNotes(gatherReviewNotes(phases));
  });
}

export function loadPhaseContents(
  info: RunReviewInfo,
): Effect.Effect<LoadPhaseContentsResult, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const phaseIds = info.phaseStatuses
      .toSorted((a, b) => a.phaseIndex - b.phaseIndex)
      .map((p) => p.phaseId);

    const missingPhases: string[] = [];
    const missingPaths: string[] = [];
    const phaseContents: PhaseContent[] = [];

    for (const phaseId of phaseIds) {
      const title = info.planPhases.find((p) => p.id === phaseId)?.title ?? phaseId;
      const fileRecMdPath = join(info.runPath, phaseId, "file-reconciliation.md");
      const phaseHandoffPath = join(info.runPath, phaseId, "phase-handoff.md");

      const fileRecMdResult = yield* Effect.either(fs.readText(fileRecMdPath));
      const phaseHandoffResult = yield* Effect.either(fs.readText(phaseHandoffPath));

      if (Either.isLeft(fileRecMdResult)) {
        missingPhases.push(phaseId);
        missingPaths.push(fileRecMdPath);
      }
      if (Either.isLeft(phaseHandoffResult)) {
        missingPhases.push(phaseId);
        missingPaths.push(phaseHandoffPath);
      }

      phaseContents.push({
        phaseId,
        title,
        fileReconciliationMd: Either.isRight(fileRecMdResult)
          ? fileRecMdResult.right
          : `> PARTIAL — file-reconciliation.md missing for ${phaseId}`,
        phaseHandoffMd: Either.isRight(phaseHandoffResult)
          ? phaseHandoffResult.right
          : `> PARTIAL — phase-handoff.md missing for ${phaseId}`,
      });
    }

    return { phaseContents, missingPhases, missingPaths };
  });
}

export function loadReviewHandoffInputs(
  info: RunReviewInfo,
): Effect.Effect<ReviewHandoffInputs, ReviewHandoffArtifactMissingError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const phaseIds = info.phaseStatuses
      .toSorted((a, b) => a.phaseIndex - b.phaseIndex)
      .map((p) => p.phaseId);

    const missingPhases: string[] = [];
    const missingPaths: string[] = [];
    const perPhase = [];

    for (const phaseId of phaseIds) {
      const jsonPath = join(info.runPath, phaseId, "file-reconciliation.json");
      const readResult = yield* Effect.either(fs.readText(jsonPath));

      if (Either.isLeft(readResult)) {
        missingPhases.push(phaseId);
        missingPaths.push(jsonPath);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(readResult.right) as unknown;
      } catch {
        missingPhases.push(phaseId);
        missingPaths.push(jsonPath);
        continue;
      }

      const decoded = readPhaseFileReconciliationFile(jsonPath, parsed);
      if (Either.isLeft(decoded)) {
        missingPhases.push(phaseId);
        missingPaths.push(jsonPath);
        continue;
      }

      perPhase.push(decoded.right);
    }

    if (missingPhases.length > 0) {
      yield* Effect.fail(
        new ReviewHandoffArtifactMissingError({
          message: `Missing or undecodable file-reconciliation.json for phases: ${missingPhases.join(", ")}`,
          missingPhases,
          missingPaths,
        }),
      );
    }

    const global = aggregateGlobalReconciliation(perPhase);
    const globalMd = renderGlobalReconciliationMarkdown(
      global,
      runKey(info.namespace, info.shortName),
    );
    const { phaseContents } = yield* loadPhaseContents(info);
    const sourceSpecOutcomeMd = yield* loadSourceSpecOutcome(info);
    const reviewNotesMd = yield* loadReviewNotes(info);

    return { global, globalMd, phaseContents, sourceSpecOutcomeMd, reviewNotesMd };
  });
}
