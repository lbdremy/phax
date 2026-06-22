import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";

export interface ValidateOptions {
  config: string;
  plan: string;
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
  out.log(`✓ phax.json is valid (project: ${configResult.right.namespace})`);

  const planResult = loadPlan(opts.plan);
  if (Either.isLeft(planResult)) {
    out.error(`Plan validation failed: ${planResult.left.message}`);
    if (planResult.left.path) {
      out.error(`  at: ${planResult.left.path}`);
    }
    return 1;
  }
  const plan = planResult.right;
  out.log(`✓ ${opts.plan} is valid (run: ${plan.run.shortName}, ${plan.phases.length} phase(s))`);

  return 0;
}
