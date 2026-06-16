import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { makeNodeEditorLayer } from "../../infra/editor.js";
import { Editor } from "../../ports/editor.js";
import {
  resolveRunByShortName,
  resolveLastReviewOpenRun,
  type RunReviewInfo,
} from "../../app/resolveRunInfo.js";

async function openRun(info: RunReviewInfo, out: OutputPort): Promise<number> {
  if (!info.worktreePath) {
    out.error(`No worktree path found for run "${info.shortName}".`);
    return 1;
  }

  const effect = Effect.gen(function* () {
    const editor = yield* Editor;
    yield* editor.open(info.worktreePath);
  }).pipe(Effect.provide(makeNodeEditorLayer()));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Failed to open worktree: ${result.left.message}`);
    return 1;
  }

  out.log(`Opened ${info.worktreePath}`);
  return 0;
}

export async function runOpen(shortNameArg: string, out: OutputPort): Promise<number> {
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

  return openRun(infoResult.right, out);
}

export async function runOpenLast(out: OutputPort): Promise<number> {
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

  return openRun(infoResult.right, out);
}
