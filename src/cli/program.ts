import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { isInPhaseWorktree } from "../app/loadConfig.js";
import { phaseGuardRefusal } from "../domain/security/phaseGuard.js";
import { cliDocs } from "./cliDocs.js";
import { readPackageVersion, runUsageFlagAndExit } from "./commands/usage.js";
import { runUnlock } from "./commands/unlock.js";
import { runEnter } from "./commands/enter.js";
import { runEnterPhase } from "./commands/enterPhase.js";
import { runShell } from "./commands/shell.js";
import { runOpen } from "./commands/open.js";
import { runArchive } from "./commands/archive.js";
import { runPrune } from "./commands/prune.js";
import { registerPruneCommand } from "./commands/pruneRegister.js";
import { runReviewHandoff } from "./commands/reviewHandoff.js";
import { runPublishPr } from "./commands/publishPr.js";
import { runReviewCompliance } from "./commands/reviewCompliance.js";
import { runReviewCode } from "./commands/reviewCode.js";
import { runAdjustPlan } from "./commands/adjustPlan.js";
import { runRun } from "./commands/run.js";
import { runResume } from "./commands/resume.js";
import { registerResumeCommand } from "./commands/resumeRegister.js";
import { runResetPhase } from "./commands/resetPhase.js";
import { registerResetPhaseCommand } from "./commands/resetPhaseRegister.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerArtifactCommand } from "./commands/artifact.js";
import { registerRecordsCommand } from "./commands/records.js";
import { runInit } from "./commands/init.js";
import { mountRunnerGroupStub, mountRunnerStub, mountRunnerStubs } from "./bridge.js";
import { OPTION_HELP } from "./commandLibrary/contract/index.js";
import { phaxProgram } from "./definitions/program.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("phax")
    .description("Drive AI coding agents through isolated, gated phases")
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
    )
    // Help only: the bridge sends `phax --json-schema` to the runner before Commander parses.
    .option("--json-schema", OPTION_HELP.anyJsonSchema);

  program.hook("preAction", async (_root, actionCommand) => {
    const opts = program.opts<{ usage?: boolean; usageFormat?: string }>();
    if (opts.usage === true) {
      // Resolves only via process.exit() inside runUsageFlagAndExit — which is
      // itself timeout-bounded — so Commander never proceeds to the matched
      // subcommand's action, and a wedged write can't hang here forever.
      await runUsageFlagAndExit(opts.usageFormat ?? "kdl");
    }
    // The phase guard: inside a phase worktree, refuse before the action runs.
    if (isInPhaseWorktree(process.cwd())) {
      const refusal = phaseGuardRefusal(commandPath(actionCommand), actionCommand.opts());
      if (refusal !== undefined) {
        consoleOutput.error(refusal);
        process.exit(1);
      }
    }
  });

  function globalTraceOpts(): { verbose?: boolean; trace?: boolean } {
    const g = program.opts<{ verbose?: boolean; trace?: boolean }>();
    const result: { verbose?: boolean; trace?: boolean } = {};
    if (g.verbose !== undefined) result.verbose = g.verbose;
    if (g.trace !== undefined) result.trace = g.trace;
    return result;
  }

  mountRunnerStub(program, phaxProgram, ["validate"]);

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
    .command("enter")
    .description("Resume the final phase's agent session interactively")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runEnter(shortName, consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("enter-phase")
    .description("Resume a specific phase's agent session interactively")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .argument("<phase-id>", "Phase identifier, e.g. phase-02")
    .option(
      "--new-session",
      "At a stopped phase, run a new read-only first turn and continue its session",
    )
    .action(async (shortName: string, phaseId: string, opts: { newSession?: boolean }) => {
      const exitCode = await runEnterPhase(shortName, phaseId, consoleOutput, opts);
      process.exit(exitCode);
    });

  mountRunnerStub(program, phaxProgram, ["session-info"]);

  program
    .command("shell")
    .description("Open a shell in the final worktree")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runShell(shortName, consoleOutput);
      process.exit(exitCode);
    });

  mountRunnerStub(program, phaxProgram, ["path"]);

  program
    .command("open")
    .description("Open the final worktree in the configured editor")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runOpen(shortName, consoleOutput);
      process.exit(exitCode);
    });

  // `ls` answers through the runner: its help-only stub, at its place in the help.
  mountRunnerStub(program, phaxProgram, ["ls"]);

  program
    .command("archive")
    .description("Archive a run that is not running; --force is required for an unfinished run")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .option(
      "--force",
      "Archive even if the run is unfinished or a worktree has uncommitted changes",
    )
    .action(async (shortName: string, opts: { force?: boolean }) => {
      const exitCode = await runArchive(shortName, opts, consoleOutput);
      process.exit(exitCode);
    });

  registerPruneCommand(program, runPrune, consoleOutput);
  // `cost` answers through the runner, which holds the whole group: a help-only stub, in place.
  mountRunnerGroupStub(program, phaxProgram, ["cost"]);

  program
    .command("run")
    .description("Extract a plan from plan.md and run all phases, or preview with --dry-run")
    .argument("[short-name]", "Run short name, e.g. usage-cli")
    .requiredOption("--plan <path>", "Path to the plan.md file to extract from")
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
    .option("--refresh", "Re-extract the plan even if a cached extraction exists")
    .option(
      "--allow-skill-edits",
      "Allow phases to edit the .claude/skills files the plan declares",
    )
    .option(
      "--hold [selection]",
      "Stop for review once these headless phases commit: no value for every phase but the final one, acceptance, or phase ids such as phase-02,phase-04",
    )
    .action(
      async (
        shortName: string | undefined,
        opts: {
          plan: string;
          allowDirty?: boolean;
          providerPriority?: string;
          dryRun?: boolean;
          refresh?: boolean;
          allowSkillEdits?: boolean;
          hold?: true | string;
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
    .description("Run a plan-compliance review for a review_open run and record its result")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .action(async (shortName: string) => {
      const exitCode = await runReviewCompliance(shortName, globalTraceOpts(), consoleOutput);
      process.exit(exitCode);
    });

  program
    .command("review-code")
    .description(
      "Open an interactive, pre-prompted code-review session for a review_open run, or run the review headless with --headless",
    )
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .option("--new-session", "Start a fresh review session instead of resuming the existing one")
    .option(
      "--model <model>",
      "Override the model, including on resume (default: review.code.model, else claude-opus-5-5)",
    )
    .option(
      "--effort <effort>",
      "Override the effort (low | medium | high), including on resume (default: review.code.effort, else high)",
    )
    .option(
      "--headless",
      "Run the code review without a person: write code-review.json and record the session for review-code to resume; runs whether or not review.code.enabled is set",
    )
    .action(
      async (
        shortName: string,
        opts: { newSession?: boolean; model?: string; effort?: string; headless?: boolean },
      ) => {
        const exitCode = await runReviewCode(
          shortName,
          { ...opts, ...globalTraceOpts() },
          consoleOutput,
        );
        process.exit(exitCode);
      },
    );

  program
    .command("adjust-plan")
    .description("Open an interactive session to adjust a plan after a landed run")
    .argument("<plan>", "Path to the plan.md to adjust")
    .requiredOption("--landed <run>", "The landed run whose actual changes drive the adjustment")
    .option("--new-session", "Start a fresh adjustment session instead of resuming")
    .option("--model <model>", "Override the model (default: claude-opus-5-5)")
    .option("--effort <effort>", "Override the effort (low | medium | high)")
    .action(
      async (
        plan: string,
        opts: { landed: string; newSession?: boolean; model?: string; effort?: string },
      ) => {
        const exitCode = await runAdjustPlan(
          plan,
          { ...opts, ...globalTraceOpts() },
          consoleOutput,
        );
        process.exit(exitCode);
      },
    );

  mountRunnerStub(program, phaxProgram, ["brief"]);
  mountRunnerStub(program, phaxProgram, ["architecture"]);

  program
    .command("init")
    .description("Create phax.json and phax.schema.json in the current directory")
    .option("--force", "Overwrite and reconfigure an existing phax.json")
    .option("--yes", "Accept detected defaults without prompting")
    .action(async (opts: { force?: boolean; yes?: boolean }) => {
      const exitCode = await runInit(opts, consoleOutput);
      process.exit(exitCode);
    });

  mountRunnerStub(program, phaxProgram, ["report"]);
  mountRunnerStub(program, phaxProgram, ["completions"]);

  registerResumeCommand(program, runResume, consoleOutput, globalTraceOpts);
  registerResetPhaseCommand(program, runResetPhase, consoleOutput, globalTraceOpts);
  registerAgentCommand(program, consoleOutput);
  mountRunnerGroupStub(program, phaxProgram, ["security"]);
  mountRunnerGroupStub(program, phaxProgram, ["skills"]);
  mountRunnerGroupStub(program, phaxProgram, ["schema"]);
  registerArtifactCommand(program, consoleOutput);
  // `plans` answers through the runner, which holds the whole group: a help-only stub, in place.
  mountRunnerGroupStub(program, phaxProgram, ["plans"]);
  registerRecordsCommand(program, consoleOutput);

  // The runner's commands, mounted for help only: the bridge sends every call
  // naming one to the runner before Commander parses. Those a registration
  // mounted at their place are kept; any other goes at the end of its group.
  mountRunnerStubs(program, phaxProgram);

  // Wire long help and examples into the runtime --help output after all
  // registrations so commands from *Register.ts files are covered without
  // touching those files.
  for (const cmd of program.commands) applyCliDocs(cmd, "");

  return program;
}

// The space-joined subcommand path, e.g. `artifact new spec`.
function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c?.parent; c = c.parent) names.unshift(c.name());
  return names.join(" ");
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
