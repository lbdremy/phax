import { resolve } from "node:path";
import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { invalidBoundMessages } from "../../app/assignmentBounds.js";
import { loadConfig, describeConfigSources } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";
import { makeRepoRootedFileSystemLayer } from "./runLayers.js";

export interface ValidateOptions {
  plan?: string;
}

export async function runValidate(opts: ValidateOptions, out: OutputPort): Promise<number> {
  const cwd = process.cwd();

  const configResult = loadConfig(cwd);
  if (Either.isLeft(configResult)) {
    out.error(`Config validation failed: ${configResult.left.message}`);
    if (configResult.left.path) {
      out.error(`  at: ${configResult.left.path}`);
    }
    return 2;
  }
  const config = configResult.right;
  const sources = describeConfigSources(cwd);

  // The bounds are checked before the config is reported valid, so a bad bound
  // never follows a success line.
  if (config.assignments !== undefined) {
    const checked = await Effect.runPromise(
      Effect.either(
        invalidBoundMessages(config).pipe(Effect.provide(makeRepoRootedFileSystemLayer(config))),
      ),
    );
    const problems = Either.isRight(checked) ? checked.right : [checked.left.message];
    if (problems.length > 0) {
      for (const problem of problems) out.error(`Config validation failed: ${problem}`);
      const at = Either.isRight(checked) ? sources?.project : checked.left.path;
      if (at !== undefined) out.error(`  at: ${at}`);
      return 2;
    }
  }

  out.log(`✓ config is valid (project: ${config.namespace})`);
  if (sources !== undefined) {
    out.log(`  project: ${sources.project}`);
    out.log(`  local:   ${sources.localOverlay ?? "(none)"}`);
    out.log(`  global:  ${sources.globalOverlay ?? "(none)"}`);
  }
  if (config.assignments !== undefined) {
    const parts = config.assignments.filter((bound) => bound.kind === "part").length;
    const globs = config.assignments.length - parts;
    out.log(`  ${config.assignments.length} assignment bounds (${parts} part, ${globs} globs)`);
  }

  if (opts.plan !== undefined) {
    // Resolve explicitly against cwd here, at the command layer, rather than
    // relying on loadPlan's underlying readFileSync to do it implicitly.
    const resolvedPlanPath = resolve(cwd, opts.plan);
    const planResult = loadPlan(resolvedPlanPath);
    if (Either.isLeft(planResult)) {
      // loadPlan's message and path embed the resolved absolute path; swap
      // back to what the user typed so the error names a path they wrote.
      const message = planResult.left.message.split(resolvedPlanPath).join(opts.plan);
      out.error(`Plan validation failed: ${message}`);
      if (planResult.left.path) {
        out.error(`  at: ${opts.plan}`);
      }
      return 2;
    }
    const plan = planResult.right;
    out.log(`✓ ${opts.plan} is valid (run: ${plan.run.shortName}, ${plan.phases.length} phase(s))`);
  }

  return 0;
}
