import { Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import {
  decodeRunStatus,
  encodeRunStatus,
  decodePhaseStatus,
  encodePhaseStatus,
} from "../schemas/status.js";
import { openRunReview, committedToReviewOpen } from "../domain/state.js";
import type { RunReviewInfo } from "./resolveRunInfo.js";

function buildReviewHandoffMarkdown(info: RunReviewInfo): string {
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

function transitionRunToReviewOpen(runPath: string): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(runPath, "run-status.json");
    const raw = yield* fs.readText(statusPath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    const decoded = decodeRunStatus(parsed);
    if (Either.isRight(decoded)) {
      const transition = openRunReview(decoded.right.state);
      if (Either.isRight(transition)) {
        yield* fs.writeAtomic(
          statusPath,
          JSON.stringify(
            encodeRunStatus({
              ...decoded.right,
              state: transition.right,
              updatedAt: new Date().toISOString(),
            }),
            null,
            2,
          ),
        );
      }
    }
  });
}

function transitionFinalPhaseToReviewOpen(
  runPath: string,
  finalPhaseId: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(runPath, finalPhaseId, "status.json");
    const raw = yield* fs.readText(statusPath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    const decoded = decodePhaseStatus(parsed);
    if (Either.isRight(decoded)) {
      const transition = committedToReviewOpen(decoded.right.state);
      if (Either.isRight(transition)) {
        yield* fs.writeAtomic(
          statusPath,
          JSON.stringify(
            encodePhaseStatus({
              ...decoded.right,
              state: transition.right,
              updatedAt: new Date().toISOString(),
            }),
            null,
            2,
          ),
        );
      }
    }
  });
}

export function openFinalReview(info: RunReviewInfo): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    yield* transitionRunToReviewOpen(info.runPath);
    yield* transitionFinalPhaseToReviewOpen(info.runPath, info.finalPhaseId);

    const handoffContent = buildReviewHandoffMarkdown(info);
    yield* fs.writeAtomic(join(info.runPath, "review-handoff.md"), handoffContent);
  });
}
