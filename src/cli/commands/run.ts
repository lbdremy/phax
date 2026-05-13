import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadPlan } from "../../app/loadPlan.js";
import { buildDryRunReport, formatDryRunReport } from "../../app/dryRun.js";
import { setRunInterruptContext, clearRunInterruptContext } from "../interruptHandler.js";

export interface RunCommandOptions {
  plan?: string;
  dryRun?: boolean;
  profile?: string;
}

export async function runRun(opts: RunCommandOptions, out: OutputPort): Promise<number> {
  const planPath = opts.plan ?? "phax-plan.json";

  if (opts.dryRun) {
    const reportResult = buildDryRunReport(process.cwd(), planPath, opts.profile);
    if (Either.isLeft(reportResult)) {
      out.error(reportResult.left);
      return 1;
    }
    out.log(formatDryRunReport(reportResult.right));
    return 0;
  }

  // Full execution path — resolve config and plan first, then orchestrate
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;

  const planResult = loadPlan(planPath);
  if (Either.isLeft(planResult)) {
    out.error(`Plan error: ${planResult.left.message}`);
    return 1;
  }
  const plan = planResult.right;

  setRunInterruptContext(plan.run.shortName, config.stateRoot);
  try {
    out.error(
      "phax run (full execution) is not yet implemented. Use --dry-run to preview the plan.",
    );
    return 1;
  } finally {
    clearRunInterruptContext();
  }
}
