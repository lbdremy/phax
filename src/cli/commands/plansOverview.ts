import { relative, resolve, sep } from "node:path";
import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { planOverview } from "../../app/planOverview.js";
import { renderOverview } from "../../domain/plan/overviewRender.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { makeRepoRootedFileSystemLayer } from "./runLayers.js";

export interface PlansOverviewCommandOptions {
  readonly json?: true;
}

export async function runPlansOverview(
  plan: string,
  opts: PlansOverviewCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    // 2, as for every invalid config: exit 1 means the plan could not be shown.
    out.error(`Config error: ${configResult.left.message}`);
    return 2;
  }
  const config = configResult.right;

  // Absolutized against the invocation directory and made repo-relative, as
  // `plans lint` does.
  const planMdPath = resolve(process.cwd(), plan);
  const repoRelPath = relative(config.repoRoot, planMdPath).split(sep).join("/");

  // Filesystem and shell only, no Backend, so the overview cannot reach a model.
  const result = await Effect.runPromise(
    planOverview({ planMdPath, reportPath: plan, repoRelPath, config }).pipe(
      Effect.either,
      Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeShellLayer)),
    ),
  );
  if (Either.isLeft(result)) {
    out.error(result.left.line);
    return 1;
  }
  const overview = result.right;

  // stderr in both modes, so a --json stdout stays one document.
  if (overview.architecture.kind === "failed") {
    out.warn(`Warning: architecture provider failed: ${overview.architecture.message}`);
  }
  out.log(opts.json === true ? JSON.stringify(overview, null, 2) : renderOverview(overview));
  return 0;
}
