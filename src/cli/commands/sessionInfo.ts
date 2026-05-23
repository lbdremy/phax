import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunByShortName, findCurrentPhase } from "../../app/resolveRunInfo.js";
import { canResume } from "../../app/resume.js";
import { composePhaxState } from "../../app/phaxState.js";
import type { RunStatus } from "../../schemas/status.js";

export async function runSessionInfo(shortNameArg: string, out: OutputPort): Promise<number> {
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

  const info = infoResult.right;
  const currentPhase = findCurrentPhase(info.phaseStatuses);

  out.log(`Run:              ${info.shortName} (${info.runId})`);
  out.log(`Status:           ${info.runState}`);

  if (currentPhase) {
    const phasePlan = info.planPhases.find((p) => p.id === currentPhase.phaseId);
    const phaseTitle = phasePlan?.title ?? currentPhase.phaseId;
    out.log(`Current phase:    ${currentPhase.phaseId} — ${phaseTitle} (${currentPhase.state})`);
    out.log(`Worktree:         ${currentPhase.worktreePath ?? "(none)"}`);
    out.log(`Claude session:   ${currentPhase.claudeSessionId ?? "(none)"}`);
  } else {
    out.log(`Current phase:    (none — all phases terminal)`);
    out.log(`Worktree:         ${info.worktreePath || "(none)"}`);
    out.log(`Claude session:   ${info.claudeSessionId ?? "(none)"}`);
  }

  const sessionId = currentPhase?.claudeSessionId ?? info.claudeSessionId;
  const hasSession = Boolean(sessionId);

  out.log(
    `Suggested enter:  ${
      hasSession
        ? `phax enter-phase ${info.shortName} ${currentPhase?.phaseId ?? info.finalPhaseId}`
        : "(no session available)"
    }`,
  );

  const runState = composePhaxState(
    info.runState as RunStatus["state"],
    info.lastError,
    currentPhase,
  );
  out.log(
    `Suggested resume: ${
      canResume(runState)
        ? `phax resume ${info.shortName}`
        : "(run is not resumable from this state)"
    }`,
  );

  if (info.lastError) {
    out.log(`Last error:       ${info.lastError}`);
  }
  if (info.stoppedReason) {
    out.log(`Stopped reason:   ${info.stoppedReason}`);
  }

  return 0;
}
