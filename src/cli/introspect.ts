import type { Command } from "commander";

export interface CommandNode {
  name: string;
  /** Sorted long flag names without the leading '--'. */
  flags: string[];
  subcommands: CommandNode[];
}

// Commander (v12) tracks a command's hidden flag on the private `_hidden`
// field with no public getter. A retired verb (e.g. `artifact archive`) is
// registered hidden and is absent from phax.usage.kdl (generate-usage-spec.ts
// applies the same skip), so this snapshot must skip it too or the parity
// gate reports a false mismatch.
export function isHiddenCommand(cmd: Command): boolean {
  return Boolean((cmd as unknown as Record<string, boolean | undefined>)["_hidden"]);
}

/**
 * The long flags kept registered (hidden) only so their command can refuse
 * them by name, with the remedy. They are absent from phax.usage.kdl, so the
 * parity snapshot skips exactly these: any other hidden option is still walked
 * and still fails the parity check when it is undocumented. Empty a flag out
 * of this list when its refusal goes.
 */
export const RETIRED_OPTIONS: readonly string[] = ["--skip-oracle"];

/** Whether an option is one of RETIRED_OPTIONS. */
export function isRetiredOption(option: { readonly long?: string | undefined }): boolean {
  return option.long !== undefined && RETIRED_OPTIONS.includes(option.long);
}

function walkCommand(cmd: Command): CommandNode {
  const flags = cmd.options
    .filter((opt) => !isRetiredOption(opt))
    .map((opt) => opt.long)
    .filter((long): long is string => long !== undefined)
    .map((long) => long.replace(/^--/, ""))
    .toSorted();

  return {
    name: cmd.name(),
    flags,
    subcommands: cmd.commands.filter((sub) => !isHiddenCommand(sub)).map(walkCommand),
  };
}

/**
 * Walk the Commander program tree and return a normalized, side-effect-free
 * snapshot suitable for comparison against the Usage spec.
 *
 * Only long flag names from cmd.options are captured — Commander's auto-added
 * --help is stored on _helpOption (not in options) and is excluded naturally.
 * The options named by RETIRED_OPTIONS are skipped; no other hidden option is.
 */
export function extractCommandTree(program: Command): CommandNode {
  return walkCommand(program);
}
