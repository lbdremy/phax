import { spawnSync } from "node:child_process";
import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import {
  resolveRunByShortName,
  resolveLastReviewOpenRun,
  type RunReviewInfo,
} from "../../app/resolveRunInfo.js";

const ENTERABLE_RUN_STATES = new Set(["review_open", "rate_limited", "interrupted", "failed"]);

export function spawnClaudeResume(
  sessionId: string,
  worktreePath: string,
  out: OutputPort,
): number {
  out.log(`Entering Claude session ${sessionId} in ${worktreePath}`);

  const result = spawnSync("claude", ["--resume", sessionId], {
    cwd: worktreePath,
    stdio: "inherit",
  });

  if (result.error) {
    out.error(`Failed to launch claude: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 0;
}

function enterRun(info: RunReviewInfo, out: OutputPort): number {
  if (!ENTERABLE_RUN_STATES.has(info.runState)) {
    out.error(
      `Run "${info.shortName}" is in state "${info.runState}" — no interactive session is available. ` +
        `Entry is only possible for: ${[...ENTERABLE_RUN_STATES].join(", ")}.`,
    );
    return 1;
  }

  if (!info.claudeSessionId) {
    out.error(`No Claude session ID found for run "${info.shortName}".`);
    return 1;
  }
  if (!info.worktreePath) {
    out.error(`No worktree path found for run "${info.shortName}".`);
    return 1;
  }

  return spawnClaudeResume(info.claudeSessionId, info.worktreePath, out);
}

export async function runEnter(shortNameArg: string, out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot } = configResult.right;

  const shortNameResult = decodeShortName(shortNameArg);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name "${shortNameArg}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
    return 1;
  }

  const infoResult = resolveRunByShortName(shortNameResult.right, stateRoot);
  if (Either.isLeft(infoResult)) {
    out.error(`Could not resolve run "${shortNameArg}": ${infoResult.left}`);
    return 1;
  }

  return enterRun(infoResult.right, out);
}

export async function runEnterLast(out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot } = configResult.right;

  const infoResult = resolveLastReviewOpenRun(stateRoot);
  if (Either.isLeft(infoResult)) {
    out.error(`Could not find a review_open run: ${infoResult.left}`);
    return 1;
  }

  return enterRun(infoResult.right, out);
}
