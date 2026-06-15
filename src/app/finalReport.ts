import { Effect, Either } from "effect";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { FileSystem, type FsError } from "../ports/fs.js";
import { isPhaseTerminal } from "../domain/state.js";
import type { PublicationRecord } from "../domain/publish/types.js";
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

function buildEntrySection(info: RunReviewInfo): string {
  const resumeSnippet =
    info.claudeSessionId !== undefined
      ? `cd ${info.worktreePath}\nclaude --resume ${info.claudeSessionId}`
      : `cd ${info.worktreePath}\n# no session id captured`;

  return `## Entry & Resume

### Entry Commands

\`\`\`bash
# Resume the Claude session interactively
phax enter ${info.shortName}

# Open a shell in the final worktree
phax shell ${info.shortName}

# Print the worktree path (for scripting)
phax path ${info.shortName}

# Open in editor
phax open ${info.shortName}
\`\`\`

### Resume Claude Session Manually

\`\`\`bash
${resumeSnippet}
\`\`\`

### Conductor Handoff

Base Branch: \`${info.branch}\`
Final Phase Branch: \`${info.finalPhaseBranch}\`
Worktree: \`${info.worktreePath}\`

The full commit chain is on \`${info.finalPhaseBranch}\` (\`${info.branch}\` stays at the run-start commit).
Open the worktree directory in Conductor or point a new workspace at branch \`${info.finalPhaseBranch}\`.

### Archive Instructions

When you are done reviewing, finalize this run:

\`\`\`bash
phax archive ${info.shortName}
\`\`\`
`;
}

export function renderPublicationSection(record: PublicationRecord): string {
  const lines: string[] = ["## Pull request", ""];

  lines.push(`- **Provider**: ${record.provider}`);
  lines.push(`- **Remote**: ${record.remote}`);
  lines.push(`- **Branch**: \`${record.remote}/${record.branch}\``);
  if (record.baseBranch !== undefined) {
    lines.push(`- **Base branch**: \`${record.baseBranch}\``);
  }
  lines.push(`- **Push status**: ${record.pushStatus}`);
  lines.push(`- **PR status**: ${record.prStatus}`);

  if (record.pullRequestUrl !== undefined) {
    lines.push(`- **Pull request URL**: ${record.pullRequestUrl}`);
  }

  const succeeded =
    record.prStatus === "created" ||
    record.prStatus === "exists" ||
    (record.pushStatus === "pushed" && record.prStatus === "not_attempted");

  if (succeeded && record.failureReason === undefined) {
    lines.push("");
    if (record.prStatus === "created") {
      lines.push("Pull request created successfully.");
    } else if (record.prStatus === "exists") {
      lines.push("Pull request already existed; reused without creating a duplicate.");
    } else {
      lines.push("Branch pushed; PR creation was disabled.");
    }
  } else {
    lines.push("");
    if (record.failureReason !== undefined) {
      lines.push(`**Publication failed**: ${record.failureReason}`);
      lines.push("");
    }
    lines.push("Re-run publication once the issue is resolved:");
    lines.push("");
    lines.push("```bash");
    lines.push("phax publish-pr <short-name>");
    lines.push("```");
  }

  return lines.join("\n") + "\n";
}

function buildFinalReportMarkdown(info: RunReviewInfo, publication?: PublicationRecord): string {
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
  const securityPosturePairs = info.phaseStatuses
    .map((p) => ({ phaseId: p.phaseId, posture: tryReadSecurityPosture(info.runPath, p.phaseId) }))
    .filter((pair): pair is { phaseId: string; posture: SecurityPosture } => pair.posture !== null);

  const hasSecurityData = securityPosturePairs.length > 0;
  const runSecurityMode =
    hasSecurityData && securityPosturePairs.length === info.phaseStatuses.length
      ? securityPosturePairs[0]?.posture.mode
      : "(mixed)";

  const securityRows = hasSecurityData
    ? securityPosturePairs.map((pair) => formatSecurityPosture(pair.posture)).join("")
    : "| (no security data) | | | | | | | | | | | |\n";

  const agentCommandsSection = securityPosturePairs
    .filter((pair) => pair.posture.agentCommands.length > 0)
    .map((pair) => {
      const rows = pair.posture.agentCommands
        .map(
          (r) =>
            `| \`${r.command}\` | ${r.source} | ${r.explicit} | ${r.requiredByPlan} | ${r.enforcement} | ${r.degraded} |`,
        )
        .join("\n");
      return `### ${pair.phaseId}\n\n| Command | Source | Explicit | Required | Enforcement | Degraded |\n|---------|--------|----------|----------|-------------|----------|\n${rows}`;
    })
    .join("\n\n");

  const publicationSection =
    publication !== undefined ? `\n${renderPublicationSection(publication)}` : "";

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

${buildEntrySection(info)}

## Phase Details

| Phase | Title | State | Model | Effort | Commit | Session | Duration |
|-------|-------|-------|-------|--------|--------|---------|----------|
${phaseRows}

## Security

- **Run Security Mode**: ${runSecurityMode}

| Phase | Provider | Sandbox | Network Profile | MCP Mode | Allow Read | Allow Write | MCP Allow | Downgraded | Marks | Skipped for Security |
|-------|----------|---------|----------------|----------|------------|-------------|-----------|------------|-------|---------------------|
${securityRows}
${agentCommandsSection.length > 0 ? `\n### Agent Commands\n\n${agentCommandsSection}\n` : ""}
## Per-Phase Artifacts

${artifactLinks}
${publicationSection}`;
}

export function writeFinalReport(
  info: RunReviewInfo,
  publication?: PublicationRecord,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const content = buildFinalReportMarkdown(info, publication);
    yield* fs.writeAtomic(join(info.runPath, "final-report.md"), content);
  });
}
