import { consoleOutput } from "../ports/output.js";
import { setupInterruptHandlers } from "./interruptHandler.js";
import { buildProgram } from "./program.js";

setupInterruptHandlers();

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    consoleOutput.error(`Unexpected error: ${String(err)}`);
    process.exit(1);
  });
