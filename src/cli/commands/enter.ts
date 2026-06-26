import { Effect, Either } from "effect";
import { join } from "node:path";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import type { RunReviewInfo } from "../../app/resolveRunInfo.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { readAgentBinding } from "../../app/agentBinding.js";
import { getSessionAdapter } from "../../domain/session/index.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { Session } from "../../ports/session.js";

async function enterRun(
  info: RunReviewInfo,
  qualifiedName: string,
  out: OutputPort,
): Promise<number> {
  const phaseFolderPath = join(info.runPath, info.finalPhaseId);

  const bindingResult = await readAgentBinding(phaseFolderPath);
  if (Either.isLeft(bindingResult)) {
    out.error(`No agent binding found for run "${qualifiedName}": ${bindingResult.left}`);
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

export async function runEnter(shortNameArg: string, out: OutputPort): Promise<number> {
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

  return enterRun(info, qualifiedName, out);
}
