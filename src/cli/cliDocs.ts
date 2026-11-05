export interface CliDocEntry {
  longHelp: string;
  examples: string[];
}

// Command-path-keyed long help and runnable examples for documentation-heavy
// commands. Keys are the full command path (space-separated), matching the
// Usage spec emitter's path convention: "run", "enter-phase", etc.
//
// This map is the single source of truth: both the runtime --help output
// (via program.ts) and the spec generator read it, so they never disagree.
// Every command now declares its help in its runner definition
// (src/cli/definitions/), so the map holds none; it goes with the bridge.
export const cliDocs: Readonly<Record<string, CliDocEntry>> = {};
