import { Effect, Either } from "effect";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolvePhaseInfo } from "../../app/resolveRunInfo.js";
import { readAgentBinding } from "../../app/agentBinding.js";
import { getSessionAdapter } from "../../domain/session/index.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { Session } from "../../ports/session.js";

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

  const info = infoResult.right;
  const phaseFolderPath = join(info.runPath, phaseId);

  const bindingResult = await readAgentBinding(phaseFolderPath);
  if (Either.isLeft(bindingResult)) {
    out.error(
      `No agent binding found for phase "${phaseId}" of run "${info.shortName}": ${bindingResult.left}`,
    );
    return 1;
  }
  const binding = bindingResult.right;

  const invocation = getSessionAdapter(binding.provider).buildResumeInvocation(binding);
  if ("unsupported" in invocation) {
    out.error(invocation.unsupported);
    return 1;
  }

  out.log(`Entering ${invocation.executable} session in ${invocation.cwd}`);

  const effect = Effect.gen(function* () {
    const s = yield* Session;
    return yield* s.resume(invocation);
  }).pipe(Effect.provide(makeNodeSessionLayer()));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Failed to launch ${invocation.executable}: ${result.left.message}`);
    return 1;
  }
  return result.right;
}
