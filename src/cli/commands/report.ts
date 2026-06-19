import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitHubLayer } from "../../infra/github.js";
import { report } from "../../app/report.js";
import { loadConfig } from "../../app/loadConfig.js";
import { PHAX_HOME_DIR } from "../../app/loadTelemetryConfig.js";
import { readPackageVersion } from "./usage.js";

export interface ReportCommandOptions {
  noGist?: boolean;
}

function buildLayer(): Layer.Layer<
  import("../../ports/fs.js").FileSystem | import("../../ports/github.js").GitHub
> {
  return Layer.mergeAll(NodeFileSystemLayer, makeNodeGitHubLayer());
}

export async function runReport(
  shortNameArg: string | undefined,
  opts: ReportCommandOptions,
  out: OutputPort,
): Promise<number> {
  let stateRoot: string | undefined;

  if (shortNameArg !== undefined) {
    const configResult = loadConfig(process.cwd());
    if (Either.isLeft(configResult)) {
      out.error(`Config error: ${configResult.left.message}`);
      return 1;
    }
    stateRoot = configResult.right.stateRoot;
  }

  const phaxVersion = readPackageVersion();

  const effect = report({
    ...(shortNameArg !== undefined ? { shortName: shortNameArg } : {}),
    ...(stateRoot !== undefined ? { stateRoot } : {}),
    phaxHomeDir: PHAX_HOME_DIR,
    noGist: opts.noGist ?? false,
    phaxVersion,
    repo: process.cwd(),
  }).pipe(Effect.provide(buildLayer()));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    const err = result.left;
    out.error(`phax report failed: ${err.message}`);
    return 1;
  }

  out.log(`Issue created: ${result.right}`);
  return 0;
}
