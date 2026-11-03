// The command library's runner over Commander (`@steme-lab/cli-command-commander` 0.x), ported
// to Effect 3: the first runner of the contract under ../contract/. It decodes each source a
// command declares with the policy declared beside it, encodes the output, renders it, and maps
// each failure to its exit code — the program's `refused` for a call that does not decode, its
// `defect` for what no command declared. Proved by the contract's conformance suite. The names
// are the library's, so that swapping in the published package is an import change.
export { processIo } from "./processIo.js";
export { runner } from "./run.js";
