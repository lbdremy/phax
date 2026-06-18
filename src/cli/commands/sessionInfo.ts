import { Either } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunByShortName, findCurrentPhase } from "../../app/resolveRunInfo.js";
import { readAgentBinding } from "../../app/agentBinding.js";
import { inferLegacyBinding } from "../../app/inferLegacyBinding.js";
import { canResume } from "../../app/resume.js";
import { composePhaxState } from "../../app/phaxState.js";
import type { RunStatus } from "../../schemas/status.js";
import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";

export async function runSessionInfo(
  shortNameArg: string,
  out: OutputPort,
  opts: { debug?: boolean } = {},
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

  const infoResult = resolveRunByShortName(shortNameResult.right, stateRoot);
  if (Either.isLeft(infoResult)) {
    out.error(`Could not resolve run "${shortNameArg}": ${infoResult.left}`);
    return 1;
  }

  const info = infoResult.right;
  const currentPhase = findCurrentPhase(info.phaseStatuses);

  out.log(`Run:              ${info.shortName} (${info.runId})`);
  out.log(`Status:           ${info.runState}`);

  const finalPhaseId = currentPhase?.phaseId ?? info.finalPhaseId;
  const phaseFolderPath = join(stateRoot, "runs", info.shortName, finalPhaseId);
  const phasePlan = info.planPhases.find((p) => p.id === finalPhaseId);
  const phaseName = phasePlan?.title ?? info.finalPhaseTitle;
  const phaseState = currentPhase?.state ?? "review_open";

  out.log(`Phase:            ${finalPhaseId} — ${phaseName} (${phaseState})`);

  const bindingResult = await readAgentBinding(phaseFolderPath);

  let binding: PhaseAgentBinding | undefined;
  let bindingSource: "locked" | "inferred" | "unavailable" = "unavailable";

  if (Either.isRight(bindingResult)) {
    binding = bindingResult.right;
    bindingSource = "locked";
  } else {
    const inferResult = await inferLegacyBinding(phaseFolderPath, {
      shortName: info.shortName,
      runId: info.runId,
      phaseName,
    });
    if (Either.isRight(inferResult)) {
      binding = inferResult.right;
      bindingSource = "inferred";
    }
  }

  if (binding) {
    out.log(
      `Provider:         ${binding.provider}${bindingSource === "inferred" ? " (inferred)" : ""}`,
    );
    out.log(`Adapter:          ${binding.adapter}`);
    out.log(`Model:            ${binding.model}`);
    out.log(`Effort:           ${binding.effort}`);
    out.log(`Session ID:       ${binding.sessionId ?? "(none)"}`);
    out.log(`Session handle:   ${binding.sessionHandle ?? "(none)"}`);
    out.log(`Worktree:         ${binding.worktreePath}`);
    out.log(`Launched:         ${binding.launchedAt}`);
    out.log(`Lock source:      ${binding.lockSource}`);
    out.log(`Binding status:   ${binding.status}`);
  } else {
    const legacyWorktree = currentPhase?.worktreePath ?? (info.worktreePath || "(none)");
    const legacySession = currentPhase?.claudeSessionId ?? info.claudeSessionId ?? "(none)";
    out.log(
      `Provider:         (unavailable — run \`phax session-info ${info.shortName} --debug\` for available metadata)`,
    );
    out.log(`Worktree:         ${legacyWorktree}`);
    out.log(`Session ID:       ${legacySession}`);
  }

  out.log(
    `Suggested enter:  ${
      binding?.sessionId
        ? `phax enter-phase ${info.shortName} ${finalPhaseId}`
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

  if (opts.debug) {
    out.log(`\n--- Debug: agent-binding.json ---`);
    if (binding) {
      out.log(JSON.stringify(binding, null, 2));
    } else {
      out.log("(not present)");
    }

    out.log(`\n--- Debug: model-resolution.json ---`);
    try {
      const raw = await readFile(join(phaseFolderPath, "model-resolution.json"), "utf8");
      out.log(raw);
    } catch {
      out.log("(not present)");
    }
  }

  return 0;
}
