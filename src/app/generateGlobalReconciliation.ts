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
import { decodePhaseFileReconciliation } from "../schemas/reconciliation.js";
import type { PhaseFileReconciliation } from "../schemas/reconciliation.js";

export interface GenerateGlobalReconciliationOpts {
  readonly runPath: string;
  readonly phaseIds: readonly string[];
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

    for (const phaseId of opts.phaseIds) {
      const jsonPath = join(opts.runPath, phaseId, "file-reconciliation.json");
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

      const decoded = decodePhaseFileReconciliation(parsed);
      if (Either.isLeft(decoded)) {
        missingPhases.push(phaseId);
        missingPaths.push(jsonPath);
        continue;
      }

      perPhase.push(decoded.right);
    }

    if (missingPhases.length > 0 && !opts.allowPartial) {
      yield* Effect.fail(
        new ReviewHandoffArtifactMissingError({
          message: `Missing or undecodable file-reconciliation.json for phases: ${missingPhases.join(", ")}. Paths checked: ${missingPaths.join(", ")}`,
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
