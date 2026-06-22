import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { resolveLastReviewOpenRun } from "../../app/resolveRunInfo.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";

export function runPath(shortNameArg: string, out: OutputPort): number {
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

  if (!info.worktreePath) {
    out.error(`No worktree path found for run "${qualifiedName}".`);
    return 1;
  }

  out.log(info.worktreePath);
  return 0;
}

export function runPathLast(out: OutputPort): number {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const { stateRoot, namespace } = config;

  const resolveResult = resolveLastReviewOpenRun(namespace, stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left);
    return 1;
  }
  const info = resolveResult.right;
  const qualifiedName = runKey(namespace, info.shortName);
  out.log(`Last run for ${namespace}: ${qualifiedName}`);

  if (!info.worktreePath) {
    out.error(`No worktree path found for run "${qualifiedName}".`);
    return 1;
  }

  out.log(info.worktreePath);
  return 0;
}
