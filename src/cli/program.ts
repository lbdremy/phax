import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { handleUsageFlag, readPackageVersion } from "./commands/usage.js";
import { runValidate } from "./commands/validate.js";
import { runUnlock } from "./commands/unlock.js";
import { runExtractPlan } from "./commands/extractPlan.js";
import { runEnter } from "./commands/enter.js";
import { runEnterPhase } from "./commands/enterPhase.js";
import { runSessionInfo } from "./commands/sessionInfo.js";
import { runShell } from "./commands/shell.js";
import { runPath } from "./commands/path.js";
import { runOpen } from "./commands/open.js";
import { runLs } from "./commands/ls.js";
import { runArchive } from "./commands/archive.js";
import { runReviewHandoff } from "./commands/reviewHandoff.js";
import { runPublishPr } from "./commands/publishPr.js";
import { runReviewCompliance } from "./commands/reviewCompliance.js";
import { runRun } from "./commands/run.js";
import { runResume } from "./commands/resume.js";
import { registerResumeCommand } from "./commands/resumeRegister.js";
import { runResetPhase } from "./commands/resetPhase.js";
import { registerResetPhaseCommand } from "./commands/resetPhaseRegister.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerSecurityCommand } from "./commands/security.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { runInit } from "./commands/init.js";
import { registerSchemaCommand } from "./commands/schema.js";
import { runCompletions } from "./commands/completions.js";
import { runReport } from "./commands/report.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("phax")
    .description("Drive Claude Code through isolated, gated phases")
    .version(readPackageVersion())
    .showSuggestionAfterError(true)
    .configureOutput({
      outputError(str, write) {
        write(str);
        write("Run `phax --help` for usage.\n");
      },
    })
    .option("--verbose", "Print human-readable progress and system events")
    .option("--trace", "Write structured JSONL trace events to the run folder")
    .option("--usage", "Print the phax.usage.kdl CLI spec and exit")
    .option(
      "--usage-format <format>",
      "Format for --usage output: kdl (default, no external dependency) or json (requires the usage CLI)",
      "kdl",
    );

  program.hook("preAction", () => {
    const opts = program.opts<{ usage?: boolean; usageFormat?: string }>();
    if (opts.usage === true) {
      handleUsageFlag(opts.usageFormat ?? "kdl");
      process.exit(0);
    }
  });

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
    .description("Resume the final phase's agent session interactively")
    .action(async (shortName: string) => {
      const exitCode = await runEnter(shortName, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("enter-phase <short-name> <phase-id>")
    .description("Resume a specific phase's agent session interactively")
    .action(async (shortName: string, phaseId: string) => {
      const exitCode = await runEnterPhase(shortName, phaseId, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("session-info <short-name>")
    .description("Print session diagnostics for a run (state, phase, worktree, session id)")
    .option("--debug", "Dump raw binding and model-resolution metadata")
    .action(async (shortName: string, opts: { debug?: boolean }) => {
      const exitCode = await runSessionInfo(shortName, consoleOutput, opts);
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
    .command("path <short-name>")
    .description("Print the final worktree path (script-friendly, one line)")
    .action((shortName: string) => {
      const exitCode = runPath(shortName, consoleOutput);
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
    .command("run [short-name]")
    .description("Extract a plan from plan.md and run all phases, or preview with --dry-run")
    .option("--plan-md <path>", "Path to plan.md", "plan.md")
    .option("--profile <profile>", "Gate profile to use (overrides config default)")
    .option("--workspace <id>", "Workspace id (monorepo)")
    .option("--allow-dirty", "Allow starting when the working tree is dirty")
    .option(
      "--provider-priority <list>",
      "Comma-separated provider priority override (e.g. mistral-vibe,claude-code)",
    )
    .option("--dry-run", "Preview only — extracts the plan but performs no run actions")
    .option(
      "--security <mode>",
      "Security mode override (secure|unsafe|isolated, overrides config default)",
    )
    .action(
      async (
        shortName: string | undefined,
        opts: {
          planMd?: string;
          profile?: string;
          workspace?: string;
          allowDirty?: boolean;
          providerPriority?: string;
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
    .command("review-handoff <short-name>")
    .description(
      "Regenerate review-handoff.md and global file reconciliation for a review_open run",
    )
    .option("--allow-partial", "Generate a partial document when some phase artifacts are missing")
    .action(async (shortName: string, opts: { allowPartial?: boolean }) => {
      const exitCode = await runReviewHandoff(shortName, opts, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("publish-pr <short-name>")
    .description("Push the final branch and create (or reuse) a GitHub PR for a review_open run")
    .action(async (shortName: string) => {
      const exitCode = await runPublishPr(shortName, globalTraceOpts(), consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("review-compliance <short-name>")
    .description("Run a non-mutating plan-compliance review for a review_open run")
    .action(async (shortName: string) => {
      const exitCode = await runReviewCompliance(shortName, globalTraceOpts(), consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("init")
    .description("Create phax.json and phax.schema.json in the current directory")
    .option("--force", "Overwrite an existing phax.json")
    .action((opts: { force?: boolean }) => {
      const exitCode = runInit(opts, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("report [short-name]")
    .description(
      "Open a GitHub issue from local telemetry (run semantic.jsonl or latest daily journal)",
    )
    .option("--no-gist", "Inline the full log in the issue body instead of creating a secret gist")
    .action(async (shortName: string | undefined, opts: { noGist?: boolean }) => {
      const exitCode = await runReport(shortName, opts, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("completions <shell>")
    .description(
      "Generate a shell completion script (zsh, bash, fish, nu, powershell). Requires the usage CLI.",
    )
    .action((shell: string) => {
      runCompletions(shell);
    });

  registerResumeCommand(program, runResume, consoleOutput, globalTraceOpts);
  registerResetPhaseCommand(program, runResetPhase, consoleOutput, globalTraceOpts);
  registerAgentCommand(program, consoleOutput);
  registerSecurityCommand(program, consoleOutput, globalTraceOpts);
  registerSkillsCommand(program, consoleOutput);
  registerSchemaCommand(program, consoleOutput);

  return program;
}
