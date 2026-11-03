import { setupInterruptHandlers } from "./interruptHandler.js";
import { buildProgram } from "./program.js";
import { runUsageFlagAndExit } from "./commands/usage.js";
import { runBridge } from "./bridge.js";

setupInterruptHandlers();

// Check for --usage before any parser reads argv: it prints the committed
// phax.usage.kdl, whichever of Commander and the runner owns each command.
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--usage")) {
  const fmtIdx = rawArgs.indexOf("--usage-format");
  const format = fmtIdx !== -1 && fmtIdx + 1 < rawArgs.length ? rawArgs[fmtIdx + 1] : "kdl";
  void runUsageFlagAndExit(format ?? "kdl");
} else {
  // The bridge hands a runner command to the runner and any other call to
  // Commander: a refusal exits 64, a crash 70 with `defect: …`.
  runBridge(process, buildProgram);
}
