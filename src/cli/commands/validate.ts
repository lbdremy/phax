import { resolve } from "node:path";
import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig, describeConfigSources } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";

export interface ValidateOptions {
  plan?: string;
}

export function runValidate(opts: ValidateOptions, out: OutputPort): number {
  const cwd = process.cwd();

  const configResult = loadConfig(cwd);
  if (Either.isLeft(configResult)) {
    out.error(`Config validation failed: ${configResult.left.message}`);
    if (configResult.left.path) {
      out.error(`  at: ${configResult.left.path}`);
    }
    return 1;
  }
  out.log(`✓ config is valid (project: ${configResult.right.namespace})`);

  const sources = describeConfigSources(cwd);
  if (sources !== undefined) {
    out.log(`  project: ${sources.project}`);
    out.log(`  local:   ${sources.localOverlay ?? "(none)"}`);
    out.log(`  global:  ${sources.globalOverlay ?? "(none)"}`);
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
      return 1;
    }
    const plan = planResult.right;
    out.log(`✓ ${opts.plan} is valid (run: ${plan.run.shortName}, ${plan.phases.length} phase(s))`);
  }

  return 0;
}
