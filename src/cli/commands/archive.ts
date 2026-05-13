import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { archive } from "../../app/archive.js";
import { readRegistry } from "../../app/registry.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { resolveLastReviewOpenRun } from "../../app/resolveRunInfo.js";
import { decodeShortName as decode } from "../../domain/branded.js";

export interface ArchiveCommandOptions {
  force?: boolean;
}

function buildLayer(
  stateRoot: string,
): Layer.Layer<
  | import("../../ports/fs.js").FileSystem
  | import("../../ports/git.js").Git
  | import("../../ports/lock.js").Lock
> {
  return Layer.mergeAll(NodeFileSystemLayer, makeNodeGitLayer(), makeNodeLockLayer(stateRoot));
}

export async function runArchive(
  shortNameArg: string,
  opts: ArchiveCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot, repoRoot } = configResult.right;

  const shortNameResult = decodeShortName(shortNameArg);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name "${shortNameArg}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
    return 1;
  }
  const shortName = shortNameResult.right;

  const effect = archive(shortName, stateRoot, repoRoot, opts).pipe(
    Effect.provide(buildLayer(stateRoot)),
  );

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Archive failed: ${result.left.message}`);
    return 1;
  }

  out.log(`Run "${shortName}" archived successfully.`);
  return 0;
}

export async function runArchiveLast(
  opts: ArchiveCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot, repoRoot } = configResult.right;

  const infoResult = resolveLastReviewOpenRun(stateRoot);
  if (Either.isLeft(infoResult)) {
    out.error(`Could not find a review_open run: ${infoResult.left}`);
    return 1;
  }

  const shortNameResult = decode(infoResult.right.shortName);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name in registry: "${infoResult.right.shortName}"`);
    return 1;
  }
  const shortName = shortNameResult.right;

  const effect = archive(shortName, stateRoot, repoRoot, opts).pipe(
    Effect.provide(buildLayer(stateRoot)),
  );

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Archive failed: ${result.left.message}`);
    return 1;
  }

  out.log(`Run "${shortName}" archived successfully.`);
  return 0;
}
