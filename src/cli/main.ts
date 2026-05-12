import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { runValidate } from "./commands/validate.js";

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

program.parseAsync(process.argv).catch((err: unknown) => {
  consoleOutput.error(`Unexpected error: ${String(err)}`);
  process.exit(1);
});
