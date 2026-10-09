import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig, locateWorkingTree } from "../../app/loadConfig.js";
import { pullBrief } from "../../app/pullBrief.js";
import { isEmptyBrief, renderNoBrief, renderWholeBrief } from "../../domain/brief/render.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { reportConfigError } from "./reportConfigError.js";

/**
 * `phax brief [path…]`. Config comes from the repository's main checkout, so
 * a provider declared in its gitignored phax.local.json serves a pull from a
 * phase worktree too; the provider runs from the cwd's own working tree.
 */
export async function runBrief(
  paths: readonly string[],
  out: OutputPort,
  cwd: string = process.cwd(),
): Promise<number> {
  const tree = locateWorkingTree(cwd);
  if (tree === undefined) {
    out.error(`✗ phax brief: ${cwd} is not inside a git working tree`);
    return 1;
  }
  const configResult = loadConfig(tree.mainRoot);
  if (Either.isLeft(configResult)) {
    reportConfigError(configResult.left, out);
    return 2;
  }
  const { brief } = configResult.right;
  if (brief === undefined) {
    out.error(
      '✗ No brief provider is configured: add "brief": { "command": "…", "push": "findings" } to phax.json',
    );
    return 1;
  }

  const result = await Effect.runPromise(
    pullBrief({ command: brief.command, root: tree.root, cwd, paths }).pipe(
      Effect.provide(Layer.mergeAll(makeRootedNodeFileSystemLayer(tree.root), NodeShellLayer)),
    ),
  );
  if (result.kind === "refused") {
    out.error(`✗ phax brief: ${result.message}`);
    return 1;
  }
  if (result.recordWarning !== undefined) {
    out.warn(`[phax] Warning: ${result.recordWarning}.`);
  }
  if (result.kind === "failed") {
    out.error(`✗ ${result.reason}`);
    return 1;
  }
  out.log(
    isEmptyBrief(result.report) ? renderNoBrief(result.files) : renderWholeBrief(result.report),
  );
  return 0;
}
