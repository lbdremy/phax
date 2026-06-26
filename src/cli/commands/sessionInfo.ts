import { Either } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { findCurrentPhase } from "../../app/resolveRunInfo.js";
import type { RunReviewInfo } from "../../app/resolveRunInfo.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { readAgentBinding } from "../../app/agentBinding.js";
import { getSessionAdapter } from "../../domain/session/index.js";
import { canResume } from "../../app/resume.js";
import { composePhaxState } from "../../app/phaxState.js";
import type { RunStatus } from "../../schemas/status.js";
import type { PhaseAgentBinding } from "../../schemas/phaseAgentBinding.js";

async function printSessionInfo(
  info: RunReviewInfo,
  qualifiedName: string,
  out: OutputPort,
  opts: { debug?: boolean },
): Promise<number> {
  const currentPhase = findCurrentPhase(info.phaseStatuses);

  out.log(`Run:              ${qualifiedName} (${info.runId})`);
  out.log(`Status:           ${info.runState}`);

  const finalPhaseId = currentPhase?.phaseId ?? info.finalPhaseId;
  const phaseFolderPath = join(info.runPath, finalPhaseId);
  const phasePlan = info.planPhases.find((p) => p.id === finalPhaseId);
  const phaseName = phasePlan?.title ?? info.finalPhaseTitle;
  const phaseState = currentPhase?.state ?? "review_open";

  out.log(`Phase:            ${finalPhaseId} — ${phaseName} (${phaseState})`);

  const bindingResult = await readAgentBinding(phaseFolderPath);

  let binding: PhaseAgentBinding | undefined;
  if (Either.isRight(bindingResult)) {
    binding = bindingResult.right;
  }

  let resumeSupported = false;
  if (binding) {
    const invocation = getSessionAdapter(binding.provider).buildResumeInvocation(binding);
    resumeSupported = !("unsupported" in invocation);

    out.log(`Provider:         ${binding.provider}`);
    out.log(`Adapter:          ${binding.adapter}`);
    out.log(`Model:            ${binding.model}`);
    out.log(`Effort:           ${binding.effort}`);
    out.log(`Session ID:       ${binding.sessionId ?? "(none)"}`);
    out.log(`Session handle:   ${binding.sessionHandle ?? "(none)"}`);
    out.log(`Worktree:         ${binding.worktreePath}`);
    out.log(`Launched:         ${binding.launchedAt}`);
    out.log(`Binding status:   ${binding.status}`);
    if (!resumeSupported && "unsupported" in invocation) {
      out.log(`Resume:           ${invocation.unsupported}`);
    }
  } else {
    out.log(
      `Provider:         (no agent binding recorded — run \`phax session-info ${qualifiedName} --debug\` for raw metadata)`,
    );
  }

  out.log(
    `Suggested enter:  ${
      resumeSupported
        ? `phax enter-phase ${qualifiedName} ${finalPhaseId}`
        : "(interactive resume not available for this provider/session)"
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
        ? `phax resume ${qualifiedName}`
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

export async function runSessionInfo(
  shortNameArg: string,
  out: OutputPort,
  opts: { debug?: boolean } = {},
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  const config = Either.isRight(configResult) ? configResult.right : undefined;
  const stateRoot = effectiveStateRoot(config);

  const resolveResult = resolveRunRef(shortNameArg, config, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, info, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortName);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  return printSessionInfo(info, qualifiedName, out, opts);
}
