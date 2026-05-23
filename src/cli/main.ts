import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { setupInterruptHandlers } from "./interruptHandler.js";
import { runValidate } from "./commands/validate.js";
import { runUnlock } from "./commands/unlock.js";
import { runExtractPlan } from "./commands/extractPlan.js";
import { runEnter, runEnterLast } from "./commands/enter.js";
import { runEnterPhase } from "./commands/enterPhase.js";
import { runSessionInfo } from "./commands/sessionInfo.js";
import { runShell, runShellLast } from "./commands/shell.js";
import { runPath, runPathLast } from "./commands/path.js";
import { runOpen, runOpenLast } from "./commands/open.js";
import { runLs } from "./commands/ls.js";
import { runArchive, runArchiveLast } from "./commands/archive.js";
import { runRun } from "./commands/run.js";
import { runResume } from "./commands/resume.js";

setupInterruptHandlers();

const program = new Command();

program
  .name("phax")
  .description("Drive Claude Code through isolated, gated phases")
  .version("0.1.0")
  .option("--verbose", "Print human-readable progress and system events")
  .option("--trace", "Write structured JSONL trace events to the run folder");

function globalTraceOpts(): { verbose?: boolean; trace?: boolean } {
  const g = program.opts<{ verbose?: boolean; trace?: boolean }>();
  const result: { verbose?: boolean; trace?: boolean } = {};
  if (g.verbose !== undefined) result.verbose = g.verbose;
  if (g.trace !== undefined) result.trace = g.trace;
  return result;
}

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
  .option("--model <model>", "Claude model to use (overrides phax.json agent.extractPlan.model)")
  .option(
    "--effort <effort>",
    "Effort level (low|medium|high, overrides phax.json agent.extractPlan.effort)",
  )
  .action(
    async (opts: {
      planMd: string;
      out: string;
      force?: boolean;
      model?: string;
      effort?: string;
    }) => {
      const exitCode = await runExtractPlan({ ...opts, ...globalTraceOpts() }, consoleOutput);
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
  .command("enter-phase <short-name> <phase-id>")
  .description("Resume a specific phase's Claude session interactively")
  .action(async (shortName: string, phaseId: string) => {
    const exitCode = await runEnterPhase(shortName, phaseId, consoleOutput);
    process.exit(exitCode);
  });

program
  .command("session-info <short-name>")
  .description("Print session diagnostics for a run (state, phase, worktree, session id)")
  .action(async (shortName: string) => {
    const exitCode = await runSessionInfo(shortName, consoleOutput);
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

program
  .command("run [short-name]")
  .description("Extract a plan from plan.md and run all phases, or preview with --dry-run")
  .option("--plan-md <path>", "Path to plan.md", "plan.md")
  .option("--profile <profile>", "Gate profile to use (overrides config default)")
  .option("--workspace <id>", "Workspace id (monorepo)")
  .option("--allow-dirty", "Allow starting when the working tree is dirty")
  .option("--dry-run", "Preview only — extracts the plan but performs no run actions")
  .action(
    async (
      shortName: string | undefined,
      opts: {
        planMd?: string;
        profile?: string;
        workspace?: string;
        allowDirty?: boolean;
        dryRun?: boolean;
      },
    ) => {
      const merged = { ...opts, ...globalTraceOpts() };
      const exitCode = await runRun(
        shortName !== undefined ? { shortName, ...merged } : merged,
        consoleOutput,
      );
      process.exit(exitCode);
    },
  );

program
  .command("resume <short-name>")
  .description("Resume a run from its next pending phase")
  .option("--yes", "Proceed without confirmation")
  .action(async (shortName: string, opts: { yes?: boolean }) => {
    const exitCode = await runResume(shortName, { ...opts, ...globalTraceOpts() }, consoleOutput);
    process.exit(exitCode);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  consoleOutput.error(`Unexpected error: ${String(err)}`);
  process.exit(1);
});
