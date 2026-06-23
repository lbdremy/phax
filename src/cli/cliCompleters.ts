export interface CliCompleter {
  run: string;
  descriptions: boolean;
}

// Argument-name-keyed completers. Each entry is emitted as a top-level
// `complete` node in phax.usage.kdl so the `usage` CLI can offer dynamic
// candidates at Tab-time for every argument sharing that name.
//
// This map is the single source of truth — the spec generator reads it and
// emits `complete "<name>" run="<cmd>" descriptions=#true` nodes.
export const cliCompleters: Readonly<Record<string, CliCompleter>> = {
  "short-name": {
    run: "phax ls --complete",
    descriptions: true,
  },
};
