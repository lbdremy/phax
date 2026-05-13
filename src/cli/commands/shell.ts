import { spawnSync } from "node:child_process";
import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import {
  resolveRunByShortName,
  resolveLastReviewOpenRun,
  type RunReviewInfo,
} from "../../app/resolveRunInfo.js";

function shellIntoRun(info: RunReviewInfo, out: OutputPort): number {
  if (!info.worktreePath) {
    out.error(`No worktree path found for run "${info.shortName}".`);
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

  return shellIntoRun(infoResult.right, out);
}

export async function runShellLast(out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot } = configResult.right;

  const infoResult = resolveLastReviewOpenRun(stateRoot);
  if (Either.isLeft(infoResult)) {
    out.error(`Could not find a review_open run: ${infoResult.left}`);
    return 1;
  }

  return shellIntoRun(infoResult.right, out);
}
