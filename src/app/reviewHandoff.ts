import { Effect } from "effect";
import { join } from "node:path";
import { ReviewHandoffArtifactMissingError } from "../domain/errors.js";
import type { GlobalFileReconciliation } from "../domain/reconciliation/global.js";
import { findUnexplainedGlobalDeviations } from "../domain/reconciliation/explained.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { runKey } from "../domain/runRef.js";
import { isPhaseTerminal } from "../domain/state.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { writeFinalReport } from "./finalReport.js";
import { generateGlobalReconciliation } from "./generateGlobalReconciliation.js";
import {
  loadOraclePairsSection,
  loadPhaseContents,
  loadReviewNotes,
  loadSourceSpecOutcome,
  type PhaseContent,
} from "./loadReviewHandoffInputs.js";

export interface GenerateReviewHandoffOpts {
  readonly allowPartial: boolean;
}

export type { PhaseContent };

const PLAN_COMPLIANCE_REVIEW_HEADING = "## Plan compliance review";
const SOURCE_SPEC_HEADING = "## Source spec";

// Optional run-folder fragments a handoff build may carry. Each one, when
// present, renders as its own section; when absent, no section appears.
export interface ReviewHandoffExtras {
  // The plan compliance review (compliance-review.md).
  readonly complianceReviewMd?: string | undefined;
  // The source-spec outcome written by run completion (source-spec-outcome.md).
  readonly sourceSpecOutcomeMd?: string | undefined;
  // The `## Review notes` section gathered from the phases' last gate
  // attempts, rendered directly before `## Phase details`.
  readonly reviewNotesMd?: string | undefined;
  // The `## Oracle pairs` section, rendered after the unexplained deviations
  // and before the plan compliance review.
  readonly oraclePairsMd?: string | undefined;
}

function buildUnexplainedSection(
  global: GlobalFileReconciliation,
  phases: readonly PhaseContent[],
): string {
  const unexplained = findUnexplainedGlobalDeviations(
    global,
    phases.map((p) => ({ phaseId: p.phaseId, handoffMd: p.phaseHandoffMd })),
  );
  if (unexplained.length === 0) return "_None._";
  return unexplained.map((d) => `- \`${d.path}\``).join("\n");
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

export function buildReviewHandoffContent(
  info: RunReviewInfo,
  global: GlobalFileReconciliation,
  globalMd: string,
  phases: readonly PhaseContent[],
  extras: ReviewHandoffExtras = {},
): string {
  const { complianceReviewMd, sourceSpecOutcomeMd, reviewNotesMd, oraclePairsMd } = extras;
  const passed = info.phaseStatuses.filter(
    (p) => isPhaseTerminal(p.state) && p.state !== "skipped",
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
${sourceSpecOutcomeMd !== undefined ? `\n${SOURCE_SPEC_HEADING}\n\n${sourceSpecOutcomeMd.trimEnd()}\n` : ""}
${globalMd}

## Global unplanned changes

${unplannedSection}

## Global missing planned changes

${missingSection}

## Global review attention points

${buildAttentionSection(global)}

## Deviations not explained in any handoff

${buildUnexplainedSection(global, phases)}
${oraclePairsMd !== undefined ? `\n${oraclePairsMd.trimEnd()}\n` : ""}${complianceReviewMd !== undefined ? `\n${PLAN_COMPLIANCE_REVIEW_HEADING}\n\n${complianceReviewMd.trimEnd()}\n` : ""}${reviewNotesMd !== undefined ? `\n${reviewNotesMd.trimEnd()}\n` : ""}
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
      qualifiedRunName: runKey(info.namespace, info.shortName),
    });

    const globalMd = yield* fs.readText(join(info.runPath, "global-file-reconciliation.md"));

    const { phaseContents, missingPhases, missingPaths } = yield* loadPhaseContents(info);

    if (missingPhases.length > 0 && !opts.allowPartial) {
      yield* Effect.fail(
        new ReviewHandoffArtifactMissingError({
          message: `Missing phase artifacts: ${missingPaths.join(", ")}`,
          missingPhases: [...new Set(missingPhases)],
          missingPaths,
        }),
      );
    }

    const sourceSpecOutcomeMd = yield* loadSourceSpecOutcome(info);
    const reviewNotesMd = yield* loadReviewNotes(info);
    const oraclePairsMd = yield* loadOraclePairsSection(info);
    const reviewHandoffContent = buildReviewHandoffContent(info, global, globalMd, phaseContents, {
      sourceSpecOutcomeMd,
      reviewNotesMd,
      oraclePairsMd,
    });
    yield* fs.writeAtomic(join(info.runPath, "review-handoff.md"), reviewHandoffContent);

    yield* writeFinalReport(info);
  });
}
