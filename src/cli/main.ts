import { Effect } from "effect";
import { pinRunHome } from "../app/runHome.js";
import { setupInterruptHandlers } from "./interruptHandler.js";
import { runUsageFlagAndExit } from "./commands/usage.js";
import { processIo, runner } from "./commandLibrary/commander/index.js";
import { phaxProgram } from "./definitions/program.js";

setupInterruptHandlers();

/** Exits once what was written to stdout and stderr is handed off: an exit right after a write
 *  to a pipe can cut it. */
function exitAfterFlush(code: number): void {
  process.stdout.write("", () => {
    process.stderr.write("", () => {
      process.exit(code);
    });
  });
}

// Check for --usage before the runner reads argv: it prints the committed phax.usage.kdl, or
// its JSON through the `usage` CLI.
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--usage")) {
  const fmtIdx = rawArgs.indexOf("--usage-format");
  const format = fmtIdx !== -1 && fmtIdx + 1 < rawArgs.length ? rawArgs[fmtIdx + 1] : "kdl";
  void runUsageFlagAndExit(format ?? "kdl");
} else {
  // Inside one of a run's phase worktrees, the run's recorded home is this process's home (a
  // differing PHAX_HOME or a missing record is refused by the program's guard, exit 2). Set here
  // only, at the process entry: an in-process caller of the program never reads a real run.
  pinRunHome(process.cwd(), process.env);
  // The runner answers every other call: a refusal exits 64, a crash 70 with `defect: …`.
  Effect.runPromise(runner.run(phaxProgram, processIo(process))).then(exitAfterFlush, (error) => {
    process.stderr.write(`defect: ${error instanceof Error ? error.message : String(error)}\n`);
    exitAfterFlush(phaxProgram.exits.defect);
  });
}
