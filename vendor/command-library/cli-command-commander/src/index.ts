// The proposed API of @steme-lab/cli-command-commander 0.x: the first runner of the command
// library's contract (decision 34), on commander. It decodes each source a command declares with
// the policy declared beside it, encodes the output, renders it, and maps each failure to its exit
// code — the program's `refused` for a call that does not decode, its `defect` for what no command
// declared. Proved by the contract's conformance suite.
export { processIo } from "./adapters/process-io.ts";
export { runner } from "./internal/run.ts";
