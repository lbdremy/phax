import { Effect, Either } from "effect";
import { join } from "node:path";
import { ReviewHandoffArtifactMissingError } from "../domain/errors.js";
import {
  aggregateGlobalReconciliation,
  renderGlobalReconciliationMarkdown,
  type GlobalFileReconciliation,
} from "../domain/reconciliation/global.js";
import { runKey } from "../domain/runRef.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { readPhaseFileReconciliationFile } from "../schemas/persisted.js";
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

    return { global, globalMd, phaseContents, sourceSpecOutcomeMd };
  });
}
