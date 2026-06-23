import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import type { runResetPhase } from "./resetPhase.js";

export function registerResetPhaseCommand(
  program: Command,
  runResetPhaseImpl: typeof runResetPhase,
  out: OutputPort,
  getGlobalTraceOpts: () => { verbose?: boolean; trace?: boolean },
): void {
  program
    .command("reset-phase")
    .description("Reset a stuck or failed phase so phax resume re-runs it from scratch")
    .argument("<short-name>", "Run short name, e.g. usage-cli")
    .argument("[phase-id]", "Phase identifier to reset, e.g. phase-02; defaults to the stuck phase")
    .option("-y, --yes", "Proceed without confirmation (removes the worktree and branch)")
    .option("--verbose", "Print human-readable progress and system events")
    .option("--trace", "Write structured JSONL trace events to the run folder")
    .action(
      async (
        shortName: string,
        phaseId: string | undefined,
        opts: { yes?: boolean; verbose?: boolean; trace?: boolean },
      ) => {
        const merged = { ...getGlobalTraceOpts(), ...opts };
        const exitCode = await runResetPhaseImpl(shortName, phaseId, merged, out);
        process.exit(exitCode);
      },
    );
}
