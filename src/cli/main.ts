import { consoleOutput } from "../ports/output.js";
import { setupInterruptHandlers } from "./interruptHandler.js";
import { buildProgram } from "./program.js";
import { handleUsageFlag } from "./commands/usage.js";

setupInterruptHandlers();

// Check for --usage before Commander processes argv. This must happen first
// because Commander exits with code 1 when no subcommand is provided, which
// would prevent the post-parse check from ever running.
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--usage")) {
  const fmtIdx = rawArgs.indexOf("--usage-format");
  const format = fmtIdx !== -1 && fmtIdx + 1 < rawArgs.length ? rawArgs[fmtIdx + 1] : "kdl";
  handleUsageFlag(format ?? "kdl");
  process.exit(0);
}

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    consoleOutput.error(`Unexpected error: ${String(err)}`);
    process.exit(1);
  });
