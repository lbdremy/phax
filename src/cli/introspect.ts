import type { Command } from "commander";

export interface CommandNode {
  name: string;
  /** Sorted long flag names without the leading '--'. */
  flags: string[];
  subcommands: CommandNode[];
}

// Internal/hook subcommands use a __ prefix by convention and are excluded
// from the public CLI surface (usage spec, help, parity gate).
function isInternalCommand(cmd: Command): boolean {
  return cmd.name().startsWith("__");
}

function walkCommand(cmd: Command): CommandNode {
  const flags = cmd.options
    .map((opt) => opt.long)
    .filter((long): long is string => long !== undefined)
    .map((long) => long.replace(/^--/, ""))
    .toSorted();

  return {
    name: cmd.name(),
    flags,
    subcommands: cmd.commands.filter((sub) => !isInternalCommand(sub)).map(walkCommand),
  };
}

/**
 * Walk the Commander program tree and return a normalized, side-effect-free
 * snapshot suitable for comparison against the Usage spec.
 *
 * Only long flag names from cmd.options are captured — Commander's auto-added
 * --help is stored on _helpOption (not in options) and is excluded naturally.
 */
export function extractCommandTree(program: Command): CommandNode {
  return walkCommand(program);
}
