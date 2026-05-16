import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolvePhaseInfo } from "../../app/resolveRunInfo.js";
import { spawnClaudeResume } from "./enter.js";

export async function runEnterPhase(
  shortNameArg: string,
  phaseId: string,
  out: OutputPort,
): Promise<number> {
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

  const infoResult = resolvePhaseInfo(shortNameResult.right, phaseId, stateRoot);
  if (Either.isLeft(infoResult)) {
    out.error(`Could not resolve phase "${phaseId}" of run "${shortNameArg}": ${infoResult.left}`);
    return 1;
  }

  const { phaseStatus } = infoResult.right;

  if (!phaseStatus.claudeSessionId) {
    out.error(
      `No Claude session ID found for phase "${phaseId}" of run "${shortNameArg}". ` +
        `The phase may not have started yet (state: ${phaseStatus.state}).`,
    );
    return 1;
  }

  if (!phaseStatus.worktreePath) {
    out.error(
      `No worktree path found for phase "${phaseId}" of run "${shortNameArg}". ` +
        `The phase may not have been set up yet (state: ${phaseStatus.state}).`,
    );
    return 1;
  }

  return spawnClaudeResume(phaseStatus.claudeSessionId, phaseStatus.worktreePath, out);
}
