import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
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
