import type { OutputPort } from "../../src/ports/output.js";

/** An OutputPort writing to the process's own streams, as `phax run` does without `--json`:
 *  a log on stdout, a warning or an error on stderr, so a test's stream spies see them. */
export const processOutput: OutputPort = {
  log: (message) => {
    process.stdout.write(`${message}\n`);
  },
  warn: (message) => {
    process.stderr.write(`${message}\n`);
  },
  error: (message) => {
    process.stderr.write(`${message}\n`);
  },
};
