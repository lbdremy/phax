import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import type { RunReviewInfo } from "../../app/resolveRunInfo.js";
import { runKey } from "../../domain/runRef.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { makeNodeEditorLayer } from "../../infra/editor.js";
import { Editor } from "../../ports/editor.js";

async function openRun(
  info: RunReviewInfo,
  qualifiedName: string,
  out: OutputPort,
): Promise<number> {
  if (!info.worktreePath) {
    out.error(`No worktree path found for run "${qualifiedName}".`);
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

  return openRun(info, qualifiedName, out);
}
