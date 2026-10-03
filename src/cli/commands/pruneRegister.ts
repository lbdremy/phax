import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import type { PruneCommandOptions, runPrune } from "./prune.js";

export function registerPruneCommand(
  program: Command,
  runPruneImpl: typeof runPrune,
  out: OutputPort,
): void {
  program
    .command("prune")
    .description(
      "Delete archived runs of the current namespace for real, freeing their names and disk space",
    )
    .argument("[short-name...]", "Archived run short name, e.g. old-idea")
    .option("--all", "Prune every archived run of the current namespace")
    .option(
      "--force",
      "Also prune runs whose branches hold unpreserved commits (discards those commits)",
    )
    .option("--dry-run", "Print the preview and delete nothing")
    .option("-y, --yes", "Proceed without confirmation (required without a TTY)")
    .option("--json", "Output as JSON; never prompts")
    .action(async (names: string[], opts: PruneCommandOptions) => {
      const exitCode = await runPruneImpl(names, opts, out);
      process.exit(exitCode);
    });
}
