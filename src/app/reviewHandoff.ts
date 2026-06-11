import { Effect, Either } from "effect";
import { join } from "node:path";
import { ReviewHandoffArtifactMissingError } from "../domain/errors.js";
import type { GlobalFileReconciliation } from "../domain/reconciliation/global.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { writeFinalReport } from "./finalReport.js";
import { generateGlobalReconciliation } from "./generateGlobalReconciliation.js";

export interface GenerateReviewHandoffOpts {
  readonly allowPartial: boolean;
}

interface PhaseContent {
  readonly phaseId: string;
  readonly title: string;
  readonly fileReconciliationMd: string;
  readonly phaseHandoffMd: string;
}

function buildAttentionSection(global: GlobalFileReconciliation): string {
  if (global.attentionPoints.length === 0) {
    return "_No attention points._";
  }
  return global.attentionPoints
    .map((e) => {
      const phaseRefs = e.touchedInPhases.length > 0 ? e.touchedInPhases : e.plannedInPhases;
      const firstPhase = phaseRefs[0] ?? "(unknown)";
      return `- \`${e.path}\` (${e.status}) — see [${firstPhase}/phase-handoff.md](${firstPhase}/phase-handoff.md) for details`;
    })
    .join("\n");
}

function buildReviewHandoffContent(
  info: RunReviewInfo,
  global: GlobalFileReconciliation,
  globalMd: string,
  phases: readonly PhaseContent[],
): string {
  const passed = info.phaseStatuses.filter(
    (p) => p.state !== "failed" && p.state !== "skipped",
  ).length;
  const total = info.phaseStatuses.length;

  const unplannedSection =
    global.unplanned.length > 0
      ? global.unplanned
          .map((e) => `- \`${e.path}\` (touched in: ${e.touchedInPhases.join(", ")})`)
          .join("\n")
      : "_None._";

  const missingSection =
    global.missing.length > 0
      ? global.missing
          .map((e) => `- \`${e.path}\` (planned in: ${e.plannedInPhases.join(", ")})`)
          .join("\n")
      : "_None._";

  const phaseDetails = phases
    .map(
      (p) =>
        `### ${p.phaseId} — ${p.title}\n\n#### File reconciliation\n\n${p.fileReconciliationMd}\n\n#### Phase handoff\n\n${p.phaseHandoffMd}`,
    )
    .join("\n\n---\n\n");

  return `# Run Review Handoff

## Run summary

- **Short Name**: ${info.shortName}
- **Run ID**: ${info.runId}
- **Base Branch**: ${info.branch}
- **Final Phase Branch**: \`${info.finalPhaseBranch}\`
- **Gate Profile**: ${info.gateProfileId ?? "(none)"}
- **Phases**: ${passed}/${total} passed
- See [final-report.md](final-report.md) for security details and entry/resume instructions.

${globalMd}

## Global unplanned changes

${unplannedSection}

## Global missing planned changes

${missingSection}

## Global review attention points

${buildAttentionSection(global)}

## Phase details

${phaseDetails}
`;
}

export function generateReviewHandoff(
  info: RunReviewInfo,
  opts: GenerateReviewHandoffOpts,
): Effect.Effect<void, ReviewHandoffArtifactMissingError | FsError, FileSystem | SystemTelemetry> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const phaseIds = info.phaseStatuses
      .toSorted((a, b) => a.phaseIndex - b.phaseIndex)
      .map((p) => p.phaseId);

    const global = yield* generateGlobalReconciliation({
      runPath: info.runPath,
      phaseIds,
      allowPartial: opts.allowPartial,
      runId: info.runId,
    });

    const globalMd = yield* fs.readText(join(info.runPath, "global-file-reconciliation.md"));

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

    if (missingPhases.length > 0 && !opts.allowPartial) {
      yield* Effect.fail(
        new ReviewHandoffArtifactMissingError({
          message: `Missing phase artifacts: ${missingPaths.join(", ")}`,
          missingPhases: [...new Set(missingPhases)],
          missingPaths,
        }),
      );
    }

    const reviewHandoffContent = buildReviewHandoffContent(info, global, globalMd, phaseContents);
    yield* fs.writeAtomic(join(info.runPath, "review-handoff.md"), reviewHandoffContent);

    yield* writeFinalReport(info);
  });
}
