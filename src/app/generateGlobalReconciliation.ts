import { Effect, Either } from "effect";
import { join } from "node:path";
import type { RunId } from "../domain/branded.js";
import { ReviewHandoffArtifactMissingError } from "../domain/errors.js";
import {
  aggregateGlobalReconciliation,
  renderGlobalReconciliationMarkdown,
  type GlobalFileReconciliation,
} from "../domain/reconciliation/global.js";
import { makeArtifactGeneratedTelemetryEvent } from "../domain/telemetry/events.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { readPhaseFileReconciliationFile } from "../schemas/persisted.js";
import type { PhaseFileReconciliation } from "../schemas/reconciliation.js";
import type { PhaseStatus } from "../schemas/status.js";

export interface GenerateGlobalReconciliationOpts {
  readonly runPath: string;
  /**
   * The run's phases in plan order. A held, closed, corrected one also
   * contributes its correction reconciliation.
   */
  readonly phases: readonly Pick<PhaseStatus, "phaseId" | "phaseIndex" | "stop">[];
  readonly allowPartial: boolean;
  readonly runId: string;
  readonly qualifiedRunName: string;
}

export function generateGlobalReconciliation(
  opts: GenerateGlobalReconciliationOpts,
): Effect.Effect<
  GlobalFileReconciliation,
  ReviewHandoffArtifactMissingError | FsError,
  FileSystem | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const telemetry = yield* SystemTelemetry;

    const missingPhases: string[] = [];
    const missingPaths: string[] = [];
    const perPhase: PhaseFileReconciliation[] = [];

    // One reconciliation file, decoded; undefined when it cannot be read or decoded.
    const readReconciliation = (jsonPath: string) =>
      Effect.gen(function* () {
        const readResult = yield* Effect.either(fs.readText(jsonPath));
        if (Either.isLeft(readResult)) return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse(readResult.right) as unknown;
        } catch {
          return undefined;
        }
        const decoded = readPhaseFileReconciliationFile(jsonPath, parsed);
        return Either.isLeft(decoded) ? undefined : decoded.right;
      });

    for (const { phaseId, stop } of opts.phases) {
      const jsonPath = join(opts.runPath, phaseId, "file-reconciliation.json");
      const reconciliation = yield* readReconciliation(jsonPath);
      if (reconciliation === undefined) {
        missingPhases.push(phaseId);
        missingPaths.push(jsonPath);
        continue;
      }

      // A held stop's corrections are in their own file: merged into the
      // phase's entry, they read as review corrections, never as unplanned.
      if (stop?.cause === "held" && stop.status === "closed" && stop.outcome === "corrected") {
        const correctionPath = join(opts.runPath, phaseId, "correction-reconciliation.json");
        const correction = yield* readReconciliation(correctionPath);
        if (correction === undefined) {
          missingPhases.push(phaseId);
          missingPaths.push(correctionPath);
          continue;
        }
        perPhase.push({
          ...reconciliation,
          reviewCorrections: [
            ...new Set([...reconciliation.reviewCorrections, ...correction.reviewCorrections]),
          ],
        });
        continue;
      }

      perPhase.push(reconciliation);
    }

    if (missingPhases.length > 0 && !opts.allowPartial) {
      yield* Effect.fail(
        new ReviewHandoffArtifactMissingError({
          message: `Missing or undecodable reconciliation for phases: ${missingPhases.join(", ")}. Paths checked: ${missingPaths.join(", ")}`,
          missingPhases,
          missingPaths,
        }),
      );
    }

    const global = aggregateGlobalReconciliation(perPhase);

    const jsonContent = JSON.stringify(global, null, 2);

    let mdContent = renderGlobalReconciliationMarkdown(global, opts.qualifiedRunName);
    if (missingPhases.length > 0) {
      mdContent = `> PARTIAL — missing reconciliation for: ${missingPhases.join(", ")}\n\n${mdContent}`;
    }

    const jsonPath = join(opts.runPath, "global-file-reconciliation.json");
    const mdPath = join(opts.runPath, "global-file-reconciliation.md");

    yield* fs.writeAtomic(jsonPath, jsonContent);
    yield* fs.writeAtomic(mdPath, mdContent);

    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId: opts.runId as RunId,
        artifact: "global-file-reconciliation",
        path: "global-file-reconciliation.json",
      }),
    );
    yield* telemetry.recordEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId: opts.runId as RunId,
        artifact: "global-file-reconciliation",
        path: "global-file-reconciliation.md",
      }),
    );

    return global;
  });
}
