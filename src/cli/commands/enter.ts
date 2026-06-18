import { Either } from "effect";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunByShortName } from "../../app/resolveRunInfo.js";
import { readAgentBinding } from "../../app/agentBinding.js";
import { inferLegacyBinding } from "../../app/inferLegacyBinding.js";
import { getSessionAdapter, spawnInteractive } from "../../infra/sessionAdapters/index.js";

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

  const info = infoResult.right;
  const phaseFolderPath = join(stateRoot, "runs", info.shortName, info.finalPhaseId);
  const phaseName = info.finalPhaseTitle;

  const bindingResult = await readAgentBinding(phaseFolderPath);

  let binding;
  if (Either.isRight(bindingResult)) {
    binding = bindingResult.right;
  } else {
    const inferResult = await inferLegacyBinding(phaseFolderPath, {
      shortName: info.shortName,
      runId: info.runId,
      phaseName,
    });
    if (Either.isLeft(inferResult)) {
      out.error(
        `Cannot enter this phase because it was launched before phase agent bindings were introduced ` +
          `and inference failed: ${inferResult.left}`,
      );
      return 1;
    }
    binding = inferResult.right;
  }

  const invocation = getSessionAdapter(binding.provider).buildResumeInvocation(binding);
  if ("unsupported" in invocation) {
    out.error(invocation.unsupported);
    return 1;
  }

  return spawnInteractive(invocation, out);
}
