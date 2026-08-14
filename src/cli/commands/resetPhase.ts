import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { resetPhase } from "../../app/resetPhase.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeShellLayer } from "../../infra/shell.js";
import {
  makeRepoRootedFileSystemLayer,
  makeGlobalTelemetryJournalLayerOrNoop,
} from "./runLayers.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { reportConfigError } from "./reportConfigError.js";

export interface ResetPhaseCommandOptions {
  yes?: boolean;
  verbose?: boolean;
  trace?: boolean;
}

function buildLayer(
  config: ResolvedConfig,
): Layer.Layer<
  | import("../../ports/fs.js").FileSystem
  | import("../../ports/git.js").Git
  | import("../../ports/shell.js").Shell
  | import("../../ports/systemTelemetry.js").SystemTelemetry
> {
  return Layer.mergeAll(
    makeRepoRootedFileSystemLayer(config),
    NodeGitLayer,
    NodeShellLayer,
    makeGlobalTelemetryJournalLayerOrNoop(),
  );
}

export async function runResetPhase(
  shortNameArg: string,
  phaseIdArg: string | undefined,
  opts: ResetPhaseCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    reportConfigError(configResult.left, out);
    return 1;
  }
  const config = configResult.right;

  const resolveResult = resolveRunRef(shortNameArg, config, config.stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName: shortNameStr, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortNameStr);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  // Safe: resolveRunRef already validated the shortName via parseRunRef.
  const shortNameResult = decodeShortName(shortNameStr);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Internal error: resolved shortName "${shortNameStr}" is invalid.`);
    return 1;
  }
  const shortName = shortNameResult.right;

  if (!opts.yes) {
    const phaseHint = phaseIdArg !== undefined ? ` "${phaseIdArg}"` : "";
    out.log(
      `Would reset phase${phaseHint} of run "${qualifiedName}". ` +
        `This archives the phase folder and removes its worktree and branch. ` +
        `Pass --yes to proceed.`,
    );
    return 0;
  }

  const effect = resetPhase({
    namespace,
    shortName,
    phaseId: phaseIdArg,
    stateRoot: config.stateRoot,
    repoRoot: config.repoRoot,
  }).pipe(Effect.provide(buildLayer(config)));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    const err = result.left;
    out.error(`phax reset-phase failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const r = result.right;
  out.log(`Phase "${r.phaseId}" of run "${qualifiedName}" has been reset.`);
  if (r.archivedPath !== undefined) {
    out.log(`  Artifacts archived to: ${r.archivedPath}`);
  }
  if (r.worktreeRemoved) {
    out.log(`  Worktree removed.`);
  }
  if (r.branchDeleted) {
    out.log(`  Branch deleted.`);
  }
  out.log(`Run is now resumable. Use \`phax resume ${qualifiedName} --yes\` to re-run the phase.`);
  return 0;
}
