import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { cliDocs } from "./cliDocs.js";
import { handleUsageFlag, readPackageVersion } from "./commands/usage.js";
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
    .description("Drive AI Coding agent through isolated, gated phases")
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
    .command("unlock")
    .description("Remove a stale run lock; use --force to remove any lock")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
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
    .command("enter")
    .description("Resume the final phase's agent session interactively")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runEnter(shortName, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("enter-last")
    .description("Resume the final phase's session for the last review_open run in this project")
    .action(async () => {
      const exitCode = await runEnterLast(consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("enter-phase")
    .description("Resume a specific phase's agent session interactively")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .argument("<phase-id>", "Phase identifier, e.g. phase-02")
    .action(async (shortName: string, phaseId: string) => {
      const exitCode = await runEnterPhase(shortName, phaseId, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("session-info")
    .description("Print session diagnostics for a run (state, phase, worktree, session id)")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .option("--debug", "Dump raw binding and model-resolution metadata")
    .action(async (shortName: string, opts: { debug?: boolean }) => {
      const exitCode = await runSessionInfo(shortName, consoleOutput, opts);
      process.exit(exitCode);
    });

  program
    .command("shell")
    .description("Open a shell in the final worktree")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runShell(shortName, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("shell-last")
    .description("Open a shell in the final worktree for the last review_open run in this project")
    .action(async () => {
      const exitCode = await runShellLast(consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("path")
    .description("Print the final worktree path (script-friendly, one line)")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action((shortName: string) => {
      const exitCode = runPath(shortName, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("path-last")
    .description("Print the final worktree path for the last review_open run in this project")
    .action(() => {
      const exitCode = runPathLast(consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("open")
    .description("Open the final worktree in the configured editor")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runOpen(shortName, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("open-last")
    .description(
      "Open the final worktree in the configured editor for the last review_open run in this project",
    )
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
    .option("--complete", "Print run short-names for shell completion")
    .action(
      async (opts: {
        active?: boolean;
        failed?: boolean;
        reviewOpen?: boolean;
        archived?: boolean;
        json?: boolean;
        complete?: boolean;
      }) => {
        const exitCode = await runLs(opts, consoleOutput);
        process.exit(exitCode);
      },
    );

  program
    .command("archive")
    .description("Archive a completed or review_open run")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .option("--force", "Archive even if the final worktree has uncommitted changes")
    .action(async (shortName: string, opts: { force?: boolean }) => {
      const exitCode = await runArchive(shortName, opts, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("archive-last")
    .description("Archive the last review_open run in this project")
    .option("--force", "Archive even if the final worktree has uncommitted changes")
    .action(async (opts: { force?: boolean }) => {
      const exitCode = await runArchiveLast(opts, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("run")
    .description("Extract a plan from plan.md and run all phases, or preview with --dry-run")
    .argument("[short-name]", "Run short name, e.g. usage-cli")
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
    .command("review-handoff")
    .description(
      "Regenerate review-handoff.md and global file reconciliation for a review_open run",
    )
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .option("--allow-partial", "Generate a partial document when some phase artifacts are missing")
    .action(async (shortName: string, opts: { allowPartial?: boolean }) => {
      const exitCode = await runReviewHandoff(shortName, opts, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("publish-pr")
    .description("Push the final branch and create (or reuse) a GitHub PR for a review_open run")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runPublishPr(shortName, globalTraceOpts(), consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("review-compliance")
    .description("Run a non-mutating plan-compliance review for a review_open run")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
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
    .command("report")
    .description(
      "Open a GitHub issue from local telemetry (run semantic.jsonl or latest daily journal)",
    )
    .argument("[short-name]", "Run short name, e.g. usage-cli")
    .option("--no-gist", "Inline the full log in the issue body instead of creating a secret gist")
    .action(async (shortName: string | undefined, opts: { noGist?: boolean }) => {
      const exitCode = await runReport(shortName, opts, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("completions")
    .description(
      "Generate a shell completion script (zsh, bash, fish, nu, powershell). Requires the usage CLI.",
    )
    .argument("<shell>", "Shell to generate completions for (zsh, bash, fish, nu, powershell)")
    .action((shell: string) => {
      runCompletions(shell);
    });

  registerResumeCommand(program, runResume, consoleOutput, globalTraceOpts);
  registerResetPhaseCommand(program, runResetPhase, consoleOutput, globalTraceOpts);
  registerAgentCommand(program, consoleOutput);
  registerSecurityCommand(program, consoleOutput, globalTraceOpts);
  registerSkillsCommand(program, consoleOutput);
  registerSchemaCommand(program, consoleOutput);

  // Wire long help and examples into the runtime --help output after all
  // registrations so commands from *Register.ts files are covered without
  // touching those files.
  for (const cmd of program.commands) applyCliDocs(cmd, "");

  return program;
}

// Applied after all command registrations; iterates by path so nested commands
// work too. Kept at module scope so it is not recreated on every buildProgram call.
function applyCliDocs(cmd: Command, parentPath: string): void {
  const cmdPath = parentPath ? `${parentPath} ${cmd.name()}` : cmd.name();
  const entry = cliDocs[cmdPath];
  if (entry) {
    const parts: string[] = [];
    if (entry.longHelp) parts.push("\n" + entry.longHelp);
    if (entry.examples.length > 0) {
      parts.push("\nExamples:");
      parts.push(...entry.examples.map((e) => `  ${e}`));
    }
    if (parts.length > 0) cmd.addHelpText("after", parts.join("\n"));
  }
  for (const sub of cmd.commands) applyCliDocs(sub, cmdPath);
}
