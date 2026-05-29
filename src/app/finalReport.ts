import { Effect } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import { isPhaseTerminal } from "../domain/state.js";
import type { RunReviewInfo } from "./resolveRunInfo.js";
import type { PhaseStatus } from "../schemas/status.js";

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return "-";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isPhaseSuccessful(p: PhaseStatus): boolean {
  return isPhaseTerminal(p.state) && p.state !== "skipped";
}

function buildFinalReportMarkdown(info: RunReviewInfo): string {
  const passed = info.phaseStatuses.filter(isPhaseSuccessful).length;
  const failed = info.phaseStatuses.filter((p) => p.state === "failed").length;
  const total = info.phaseStatuses.length;

  const phaseRows = info.phaseStatuses
    .map((p) => {
      const planPhase = info.planPhases.find((pp) => pp.id === p.phaseId);
      const title = planPhase?.title ?? p.phaseId;
      const commit = p.commitHash ? p.commitHash.slice(0, 8) : "-";
      const session = p.claudeSessionId ? `${p.claudeSessionId.slice(0, 8)}…` : "-";
      const duration = formatDuration(p.createdAt, p.updatedAt);
      return `| ${p.phaseId} | ${title} | ${p.state} | ${p.model} | ${p.effort} | ${commit} | ${session} | ${duration} |`;
    })
    .join("\n");

  const artifactLinks = info.phaseStatuses
    .map((p) => {
      const base = `${info.runPath}/${p.phaseId}`;
      return [
        `### ${p.phaseId}`,
        `- Status: \`${base}/status.json\``,
        `- Output: \`${base}/output.jsonl\``,
        `- Prompt: \`${base}/prompt.md\``,
      ].join("\n");
    })
    .join("\n\n");

  return `# Final Report: ${info.shortName}

## Run Summary

- **Run ID**: ${info.runId}
- **Short Name**: ${info.shortName}
- **Base Branch**: ${info.branch}
- **Final Phase Branch (review here)**: \`${info.finalPhaseBranch}\`
- **State**: ${info.runState}
- **Gate Profile**: ${info.gateProfileId ?? "(none)"}
- **Total Phases**: ${total}
- **Passed**: ${passed}
- **Failed**: ${failed}

## Phase Details

| Phase | Title | State | Model | Effort | Commit | Session | Duration |
|-------|-------|-------|-------|--------|--------|---------|----------|
${phaseRows}

## Per-Phase Artifacts

${artifactLinks}
`;
}

export function writeFinalReport(info: RunReviewInfo): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const content = buildFinalReportMarkdown(info);
    yield* fs.writeAtomic(join(info.runPath, "final-report.md"), content);
  });
}
