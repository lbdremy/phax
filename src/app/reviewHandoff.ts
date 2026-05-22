import type { RunReviewInfo } from "../domain/runReviewInfo.js";

export function buildReviewHandoffMarkdown(info: RunReviewInfo): string {
  const phaseTable = info.phaseStatuses
    .map((p) => {
      const title = info.planPhases.find((pp) => pp.id === p.phaseId)?.title ?? p.phaseId;
      const commit = p.commitHash ? p.commitHash.slice(0, 8) : "(none)";
      return `| ${p.phaseId} | ${title} | ${p.state} | ${commit} |`;
    })
    .join("\n");

  const resumeSnippet =
    info.claudeSessionId !== undefined
      ? `cd ${info.worktreePath}\nclaude --resume ${info.claudeSessionId}`
      : `cd ${info.worktreePath}\n# no session id captured`;

  return `# Review Handoff: ${info.shortName}

## Run Information

- **Run ID**: ${info.runId}
- **Short Name**: ${info.shortName}
- **Branch**: ${info.branch}
- **Gate Profile**: ${info.gateProfileId ?? "(none)"}

## Final Phase

- **Phase ID**: ${info.finalPhaseId}
- **Title**: ${info.finalPhaseTitle}
- **Worktree Path**: ${info.worktreePath}
- **Claude Session ID**: ${info.claudeSessionId ?? "(none)"}

## Entry Commands

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

## Resume Claude Session Manually

\`\`\`bash
${resumeSnippet}
\`\`\`

## Conductor Handoff

Branch: \`${info.branch}\`
Worktree: \`${info.worktreePath}\`

Open the worktree directory in Conductor or point a new workspace at branch \`${info.branch}\`.

## Completed Phases

| Phase | Title | Status | Commit |
|-------|-------|--------|--------|
${phaseTable}

## Final Gates Status

Gate profile \`${info.gateProfileId ?? "(default)"}\` was used for this run.

## Archive Instructions

When you are done reviewing, finalize this run:

\`\`\`bash
phax archive ${info.shortName}
\`\`\`
`;
}
