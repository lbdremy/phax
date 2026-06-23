import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import type { runResume } from "./resume.js";

export function registerResumeCommand(
  program: Command,
  runResumeImpl: typeof runResume,
  out: OutputPort,
  getGlobalTraceOpts: () => { verbose?: boolean; trace?: boolean },
): void {
  program
    .command("resume")
    .description("Resume a run from its next pending phase")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .option("-y, --yes", "Proceed without confirmation")
    .option("--verbose", "Print human-readable progress and system events")
    .option("--trace", "Write structured JSONL trace events to the run folder")
    .option(
      "--provider-priority <list>",
      "Comma-separated provider priority override (e.g. mistral-vibe,claude-code)",
    )
    .action(
      async (
        shortName: string,
        opts: { yes?: boolean; verbose?: boolean; trace?: boolean; providerPriority?: string },
      ) => {
        const merged = { ...getGlobalTraceOpts(), ...opts };
        const exitCode = await runResumeImpl(shortName, merged, out);
        process.exit(exitCode);
      },
    );
}
