import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import { runKey } from "../../domain/runRef.js";
import { publishRun } from "../../app/publishRun.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import type { FileSystem } from "../../ports/fs.js";
import type { Git } from "../../ports/git.js";
import type { GitHub } from "../../ports/github.js";
import type { SystemTelemetry } from "../../ports/systemTelemetry.js";

export interface PublishPrCommandOptions {
  verbose?: boolean;
}

function buildLayer(): Layer.Layer<FileSystem | Git | GitHub | SystemTelemetry> {
  return Layer.mergeAll(
    NodeFileSystemLayer,
    NodeGitLayer,
    NodeGitHubLayer,
    NoopSystemTelemetryLayer,
  );
}

export async function runPublishPr(
  shortNameArg: string,
  opts: PublishPrCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;

  const resolveResult = resolveRunRef(shortNameArg, config, config.stateRoot);
  if (Either.isLeft(resolveResult)) {
    out.error(resolveResult.left.message);
    return 1;
  }
  const { namespace, shortName, info, crossProject } = resolveResult.right;
  const qualifiedName = runKey(namespace, shortName);
  if (crossProject) {
    out.log(`Target: ${qualifiedName}`);
  }

  if (info.runState !== "review_open") {
    out.error(
      `Run "${qualifiedName}" is in state "${info.runState}", not "review_open". ` +
        `The publish-pr command only operates on runs in review_open state.`,
    );
    return 1;
  }

  const effect = publishRun(info, config.publish, {
    repoRoot: config.repoRoot,
    ...(opts.verbose !== undefined ? { verbose: opts.verbose } : {}),
  }).pipe(Effect.provide(buildLayer()));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(`Unexpected error during publication: ${result.left.message}`);
    return 1;
  }

  const publication = result.right;

  if (publication.kind === "failed") {
    out.error(
      `Publication failed: ${publication.failureReason ?? "unknown error"}. ` +
        `To retry, run: phax publish-pr ${qualifiedName}`,
    );
    return 1;
  }

  // published
  if (publication.prUrl !== undefined) {
    out.log(`Pull request: ${publication.prUrl}`);
  } else {
    out.log(`Run "${qualifiedName}" published (branch pushed, no PR created).`);
  }
  return 0;
}
