import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { runValidate } from "./commands/validate.js";
import { runUnlock } from "./commands/unlock.js";
import { runExtractPlan } from "./commands/extractPlan.js";

const program = new Command();

program
  .name("phax")
  .description("Drive Claude Code through isolated, gated phases")
  .version("0.1.0");

program
  .command("validate")
  .description("Validate phax.json and phax-plan.json without any side effects")
  .option("--config <path>", "Path to phax.json", "phax.json")
  .option("--plan <path>", "Path to phax-plan.json", "phax-plan.json")
  .action((opts: { config: string; plan: string }) => {
    const exitCode = runValidate(opts, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("unlock <short-name>")
  .description("Remove a stale run lock; use --force to remove any lock")
  .option("--force", "Remove the lock regardless of staleness")
  .action(async (shortName: string, opts: { force?: boolean }) => {
    const exitCode = await runUnlock(shortName, opts, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("extract-plan")
  .description("Extract phax-plan.json from a plan.md by calling Claude Code headlessly")
  .requiredOption("--plan-md <path>", "Path to the plan.md file to extract from")
  .requiredOption("--out <path>", "Output path for phax-plan.json")
  .option("--force", "Overwrite existing output file (blocked if the run is actively locked)")
  .option("--model <model>", "Claude model to use", "claude-sonnet-4-6")
  .option("--effort <effort>", "Effort level (low|medium|high)", "medium")
  .action(
    async (opts: {
      planMd: string;
      out: string;
      force?: boolean;
      model?: string;
      effort?: string;
    }) => {
      const exitCode = await runExtractPlan(opts, consoleOutput);
      process.exit(exitCode);
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  consoleOutput.error(`Unexpected error: ${String(err)}`);
  process.exit(1);
});
