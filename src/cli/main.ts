import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { runValidate } from "./commands/validate.js";
import { runUnlock } from "./commands/unlock.js";
import { runExtractPlan } from "./commands/extractPlan.js";
import { runEnter, runEnterLast } from "./commands/enter.js";
import { runShell, runShellLast } from "./commands/shell.js";
import { runPath, runPathLast } from "./commands/path.js";
import { runOpen, runOpenLast } from "./commands/open.js";
import { runLs } from "./commands/ls.js";
import { runArchive, runArchiveLast } from "./commands/archive.js";

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

program
  .command("enter <short-name>")
  .description("Resume the final Claude session interactively")
  .action(async (shortName: string) => {
    const exitCode = await runEnter(shortName, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("enter-last")
  .description("Resume the most recent review_open run's Claude session interactively")
  .action(async () => {
    const exitCode = await runEnterLast(consoleOutput);
    process.exit(exitCode);
  });

program
  .command("shell <short-name>")
  .description("Open a shell in the final worktree")
  .action(async (shortName: string) => {
    const exitCode = await runShell(shortName, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("shell-last")
  .description("Open a shell in the most recent review_open run's final worktree")
  .action(async () => {
    const exitCode = await runShellLast(consoleOutput);
    process.exit(exitCode);
  });

program
  .command("path <short-name>")
  .description("Print the final worktree path (script-friendly, one line)")
  .action((shortName: string) => {
    const exitCode = runPath(shortName, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("path-last")
  .description("Print the final worktree path of the most recent review_open run")
  .action(() => {
    const exitCode = runPathLast(consoleOutput);
    process.exit(exitCode);
  });

program
  .command("open <short-name>")
  .description("Open the final worktree in the configured editor")
  .action(async (shortName: string) => {
    const exitCode = await runOpen(shortName, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("open-last")
  .description("Open the most recent review_open run's final worktree in the editor")
  .action(async () => {
    const exitCode = await runOpenLast(consoleOutput);
    process.exit(exitCode);
  });

program
  .command("ls")
  .description("List runs from the registry")
  .option("--active", "Show only active runs (created or running)")
  .option("--failed", "Show only failed runs")
  .option("--review-open", "Show only review_open runs")
  .option("--archived", "Show only archived runs")
  .option("--json", "Output as JSON")
  .action(
    async (opts: {
      active?: boolean;
      failed?: boolean;
      reviewOpen?: boolean;
      archived?: boolean;
      json?: boolean;
    }) => {
      const exitCode = await runLs(opts, consoleOutput);
      process.exit(exitCode);
    },
  );

program
  .command("archive <short-name>")
  .description("Archive a completed or review_open run")
  .option("--force", "Archive even if the final worktree has uncommitted changes")
  .action(async (shortName: string, opts: { force?: boolean }) => {
    const exitCode = await runArchive(shortName, opts, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("archive-last")
  .description("Archive the most recent review_open run")
  .option("--force", "Archive even if the final worktree has uncommitted changes")
  .action(async (opts: { force?: boolean }) => {
    const exitCode = await runArchiveLast(opts, consoleOutput);
    process.exit(exitCode);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  consoleOutput.error(`Unexpected error: ${String(err)}`);
  process.exit(1);
});
