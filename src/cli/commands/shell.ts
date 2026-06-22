import { spawnSync } from "node:child_process";
import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { resolveLastReviewOpenRun } from "../../app/resolveRunInfo.js";
import type { RunReviewInfo } from "../../app/resolveRunInfo.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";

function shellIntoRun(info: RunReviewInfo, qualifiedName: string, out: OutputPort): number {
  if (!info.worktreePath) {
    out.error(`No worktree path found for run "${qualifiedName}".`);
    return 1;
  }

  const shellBin = process.env["SHELL"] ?? "bash";
  out.log(`Opening shell in ${info.worktreePath}`);

  const result = spawnSync(shellBin, [], {
    cwd: info.worktreePath,
    stdio: "inherit",
  });

  if (result.error) {
    out.error(`Failed to launch shell: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 0;
}

export async function runShell(shortNameArg: string, out: OutputPort): Promise<number> {
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

  return shellIntoRun(info, qualifiedName, out);
}

export async function runShellLast(out: OutputPort): Promise<number> {
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
  out.log(`Entering last run for ${namespace}: ${qualifiedName}`);

  return shellIntoRun(info, qualifiedName, out);
}
