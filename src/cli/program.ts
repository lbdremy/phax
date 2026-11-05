import { Command } from "commander";
import { consoleOutput } from "../ports/output.js";
import { isInPhaseWorktree } from "../app/loadConfig.js";
import { phaseGuardRefusal } from "../domain/security/phaseGuard.js";
import { cliDocs } from "./cliDocs.js";
import { readPackageVersion, runUsageFlagAndExit } from "./commands/usage.js";
import { runRun } from "./commands/run.js";
import { runResume } from "./commands/resume.js";
import { registerResumeCommand } from "./commands/resumeRegister.js";
import { runResetPhase } from "./commands/resetPhase.js";
import { registerResetPhaseCommand } from "./commands/resetPhaseRegister.js";
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

  // `unlock` answers through the runner: its help-only stub, in place.
  mountRunnerStub(program, phaxProgram, ["unlock"]);

  mountRunnerStub(program, phaxProgram, ["enter"]);
  mountRunnerStub(program, phaxProgram, ["enter-phase"]);

  mountRunnerStub(program, phaxProgram, ["session-info"]);

  mountRunnerStub(program, phaxProgram, ["shell"]);

  mountRunnerStub(program, phaxProgram, ["path"]);

  mountRunnerStub(program, phaxProgram, ["open"]);

  // `ls` answers through the runner: its help-only stub, at its place in the help.
  mountRunnerStub(program, phaxProgram, ["ls"]);

  mountRunnerStub(program, phaxProgram, ["archive"]);
  mountRunnerStub(program, phaxProgram, ["prune"]);
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

  mountRunnerStub(program, phaxProgram, ["review-handoff"]);

  mountRunnerStub(program, phaxProgram, ["publish-pr"]);

  mountRunnerStub(program, phaxProgram, ["review-compliance"]);

  mountRunnerStub(program, phaxProgram, ["review-code"]);

  mountRunnerStub(program, phaxProgram, ["adjust-plan"]);

  mountRunnerStub(program, phaxProgram, ["brief"]);
  mountRunnerStub(program, phaxProgram, ["architecture"]);

  mountRunnerStub(program, phaxProgram, ["init"]);

  mountRunnerStub(program, phaxProgram, ["report"]);
  mountRunnerStub(program, phaxProgram, ["completions"]);

  registerResumeCommand(program, runResume, consoleOutput, globalTraceOpts);
  registerResetPhaseCommand(program, runResetPhase, consoleOutput, globalTraceOpts);
  // `agent` answers through the runner, which holds the whole group: a help-only stub, in place.
  mountRunnerGroupStub(program, phaxProgram, ["agent"]);
  mountRunnerGroupStub(program, phaxProgram, ["security"]);
  mountRunnerGroupStub(program, phaxProgram, ["skills"]);
  mountRunnerGroupStub(program, phaxProgram, ["schema"]);
  // `artifact` answers through the runner, which holds the whole group: a help-only stub, in place.
  mountRunnerGroupStub(program, phaxProgram, ["artifact"]);
  // `plans` answers through the runner, which holds the whole group: a help-only stub, in place.
  mountRunnerGroupStub(program, phaxProgram, ["plans"]);
  // `records` answers through the runner, which holds the whole group: a help-only stub, in place.
  mountRunnerGroupStub(program, phaxProgram, ["records"]);

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
