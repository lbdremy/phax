import { Effect, Either } from "effect";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { FileSystem, type FsError } from "../ports/fs.js";
import { isPhaseTerminal } from "../domain/state.js";
import type { RunReviewInfo } from "./resolveRunInfo.js";
import type { PhaseStatus } from "../schemas/status.js";
import { decodeSecurityPosture, type SecurityPosture } from "../schemas/securityPosture.js";

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

function tryReadSecurityPosture(runPath: string, phaseId: string): SecurityPosture | null {
  const securityPath = join(runPath, phaseId, "security.json");
  if (!existsSync(securityPath)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(securityPath, "utf8")) as unknown;
    const decoded = decodeSecurityPosture(raw);
    if (Either.isRight(decoded)) {
      return decoded.right;
    }
  } catch {
    // Ignore parse/read errors
  }
  return null;
}

function formatSecurityPosture(posture: SecurityPosture): string {
  const readPaths =
    posture.filesystem.allowRead.length > 0 ? posture.filesystem.allowRead.join(", ") : "(none)";
  const writePaths =
    posture.filesystem.allowWrite.length > 0 ? posture.filesystem.allowWrite.join(", ") : "(none)";
  const mcpAllow = posture.mcp.allow.length > 0 ? posture.mcp.allow.join(", ") : "(none)";
  const marks = posture.marks.length > 0 ? posture.marks.join(", ") : "none";
  const skipped =
    posture.providerSkippedForSecurity.length > 0
      ? posture.providerSkippedForSecurity.map((s) => `${s.provider}: ${s.reason}`).join("; ")
      : "none";

  return `
| ${posture.mode} | ${posture.provider} | ${posture.sandboxEnabled} | ${posture.network.profile} | ${posture.mcp.mode} | ${readPaths} | ${writePaths} | ${mcpAllow} | ${posture.downgraded} | ${marks} | ${skipped} |
`;
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
        `- Security: \`${base}/security.json\``,
      ].join("\n");
    })
    .join("\n\n");

  // Build Security section from security.json artifacts
  const securityPostures = info.phaseStatuses
    .map((p) => tryReadSecurityPosture(info.runPath, p.phaseId))
    .filter((p): p is SecurityPosture => p !== null);

  const hasSecurityData = securityPostures.length > 0;
  const runSecurityMode =
    hasSecurityData && securityPostures.length === info.phaseStatuses.length
      ? securityPostures[0]?.mode
      : "(mixed)";

  const securityRows = hasSecurityData
    ? securityPostures.map((p) => formatSecurityPosture(p)).join("")
    : "| (no security data) | | | | | | | | | | | |\n";

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

## Security

- **Run Security Mode**: ${runSecurityMode}

| Phase | Provider | Sandbox | Network Profile | MCP Mode | Allow Read | Allow Write | MCP Allow | Downgraded | Marks | Skipped for Security |
|-------|----------|---------|----------------|----------|------------|-------------|-----------|------------|-------|---------------------|
${securityRows}

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
