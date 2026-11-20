// Typechecked by `pnpm test:type`, never run.
import { boundedSpawn, CLI_BOUND_MS, CLI_LAUNCHER, cliArgs } from "../helpers/boundedSpawn.js";

// A call states its bound: every other option without `boundMs` does not type-check.
// @ts-expect-error: boundMs is required
boundedSpawn(CLI_LAUNCHER, cliArgs("ls"), { cwd: ".", env: {}, input: "", expectSignal: "SIGINT" });

// @ts-expect-error: boundMs is required
boundedSpawn("git", ["status"], {});

// A well-typed call: without `expectSignal`, the result is a normal exit.
const exit = boundedSpawn(CLI_LAUNCHER, cliArgs("ls"), { boundMs: CLI_BOUND_MS, cwd: "." });
const noSignal: null = exit.signal;
const status: number = exit.status;

// With `expectSignal`, the result may be the signal ending.
const ended = boundedSpawn("node", ["-e", ""], { boundMs: CLI_BOUND_MS, expectSignal: "SIGINT" });
// @ts-expect-error: the signal may be set when one is expected
const notNull: null = ended.signal;

void noSignal;
void status;
void notNull;
