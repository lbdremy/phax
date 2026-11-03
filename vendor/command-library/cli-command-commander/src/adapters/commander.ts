import { Command, CommanderError } from "commander";
import { OPTION_HELP } from "@steme-lab/cli-command";

/** What the adapter shows of an argument or an option: its help, its choices and its default.
 *  Shown only: Commander enforces none of them, the contract's decode does. */
interface Described {
  readonly help: string | undefined;
  readonly choices: ReadonlyArray<string> | undefined;
  readonly default: string | undefined;
}

/** What the adapter declares to Commander for one command. */
export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  /** A longer help, shown after the summary on the command's own `--help`. */
  readonly help?: string | undefined;
  /** Command lines shown in an `Examples:` block after the options. */
  readonly examples?: ReadonlyArray<string> | undefined;
  /** The group the command is declared under, when it has one. */
  readonly group?:
    | { readonly name: string; readonly summary: string }
    | undefined;
  /** One positional argument per tuple element, under its name. */
  readonly args: ReadonlyArray<
    Described & { readonly name: string; readonly optional: boolean }
  >;
  /** One option per field: `--kebab <field>`, or a bare switch. */
  readonly flags: ReadonlyArray<
    Described & {
      readonly field: string;
      readonly option: string;
      readonly optional: boolean;
      readonly switch: boolean;
    }
  >;
  readonly stdin: boolean;
  /** The flag the stdin read is bound to, shown in help only: the runner reads it before Commander
   *  sees the words. */
  readonly stdinFlag?: string | undefined;
  /** The command writes a document: its `--out <path>` is declared, for help only. */
  readonly writesDocument?: boolean | undefined;
  /** The variable names of the env contract, when the command declares env. */
  readonly env: ReadonlyArray<string> | undefined;
}

export interface ProgramSpec {
  readonly name: string;
  readonly version: string;
  readonly commands: ReadonlyArray<CommandSpec>;
}

export interface TerminalSpec {
  readonly columns: number;
  readonly color: boolean;
}

/** Commander's help or version, to write to `out`. */
export interface Shown {
  readonly _tag: "Shown";
  readonly text: string;
}

/** Commander's refusal, to write to `err`: an unknown command, a missing argument or option, an
 *  unknown option, or the empty call's help. */
export interface Refused {
  readonly _tag: "Refused";
  readonly text: string;
}

/** A command matched: every operand as a string, and the options given, by field name, as
 *  strings or Booleans. Nothing is defaulted. `command` is its full name, its words joined by
 *  a space. */
export interface Matched {
  readonly _tag: "Matched";
  readonly command: string;
  readonly operands: ReadonlyArray<string>;
  readonly options: Readonly<Record<string, string | boolean>>;
}

export type ParseResult = Shown | Refused | Matched;

const camelCase = (kebab: string): string =>
  kebab.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** The help line of an argument or an option: its help, then its choices and its default the way
 *  Commander writes them. Nothing when there is none. */
function describing(shown: Described): string {
  const parts: string[] = [];
  if (shown.help !== undefined) parts.push(shown.help);
  if (shown.choices !== undefined) {
    parts.push(
      `(choices: ${shown.choices.map((c) => JSON.stringify(c)).join(", ")})`,
    );
  }
  if (shown.default !== undefined) {
    parts.push(`(default: ${JSON.stringify(shown.default)})`);
  }
  return parts.join(" ");
}

/** The command's full name, its words joined by a space: what a match answers. */
const keyOf = (spec: CommandSpec): string =>
  spec.group === undefined ? spec.name : `${spec.group.name} ${spec.name}`;

function declare(
  parent: Command,
  spec: CommandSpec,
  matched: { current: Matched | undefined },
): void {
  const command = parent.command(spec.name).allowExcessArguments(true);
  if (spec.help === undefined) {
    command.description(spec.summary);
  } else {
    // The parent's list says the summary; the command's own help, the summary then the long help.
    command
      .summary(spec.summary)
      .description(`${spec.summary}\n\n${spec.help}`);
  }
  for (const arg of spec.args) {
    command.argument(
      arg.optional ? `[${arg.name}]` : `<${arg.name}>`,
      describing(arg),
    );
  }
  for (const flag of spec.flags) {
    const flags = flag.switch
      ? `--${flag.option}`
      : `--${flag.option} <${flag.field}>`;
    if (flag.optional) command.option(flags, describing(flag));
    else command.requiredOption(flags, describing(flag));
  }
  if (spec.stdinFlag !== undefined) {
    command.option(
      `--${spec.stdinFlag} [path]`,
      OPTION_HELP.stdin(spec.stdinFlag),
    );
  }
  // The runner owns these and reads them from the words before Commander sees any: they are
  // declared here for help alone.
  if (spec.writesDocument === true) {
    command.option("--out <path>", OPTION_HELP.out);
  }
  command.option("--json", OPTION_HELP.json);
  command.option("--json-schema", OPTION_HELP.jsonSchema);
  if (spec.stdin) command.addHelpText("after", "\nstdin: JSON");
  if (spec.env !== undefined) {
    command.addHelpText("after", `\nenvironment: ${spec.env.join(", ")}`);
  }
  if (spec.examples !== undefined && spec.examples.length > 0) {
    command.addHelpText(
      "after",
      `\nExamples:\n${spec.examples.map((each) => `  ${each}`).join("\n")}`,
    );
  }
  command.action(() => {
    const given = command.opts<Record<string, string | boolean | undefined>>();
    const options: Record<string, string | boolean> = {};
    for (const flag of spec.flags) {
      const value = given[camelCase(flag.option)];
      if (value !== undefined) options[flag.field] = value;
    }
    matched.current = {
      _tag: "Matched",
      command: keyOf(spec),
      operands: command.args,
      options,
    };
  });
}

/** Builds a fresh Commander tree for one call and parses the words, which are the call's arguments
 *  after the executable and the script. Commander never reads the process, never exits and never
 *  writes: its output is collected and handed back. */
export function parseCall(
  program: ProgramSpec,
  words: ReadonlyArray<string>,
  terminal: TerminalSpec,
): ParseResult {
  let out = "";
  let err = "";
  const matched: { current: Matched | undefined } = { current: undefined };
  const root = new Command()
    .name(program.name)
    .version(program.version, "--version")
    .helpCommand(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        out += text;
      },
      writeErr: (text) => {
        err += text;
      },
      outputError: (text) => {
        err += text;
      },
      getOutHelpWidth: () => terminal.columns,
      getErrHelpWidth: () => terminal.columns,
      getOutHasColors: () => terminal.color,
      getErrHasColors: () => terminal.color,
    });
  root.option("--json-schema", OPTION_HELP.programJsonSchema);
  // A group is a command of its own with the group's commands under it, declared where its first
  // command stands.
  const groups = new Map<string, Command>();
  for (const spec of program.commands) {
    const group = spec.group;
    if (group === undefined) {
      declare(root, spec, matched);
      continue;
    }
    let node = groups.get(group.name);
    if (node === undefined) {
      node = root
        .command(group.name)
        .description(group.summary)
        .helpCommand(false);
      groups.set(group.name, node);
    }
    declare(node, spec, matched);
  }
  try {
    root.parse(words, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0
        ? { _tag: "Shown", text: out }
        : { _tag: "Refused", text: err };
    }
    throw error;
  }
  return matched.current ?? { _tag: "Refused", text: err };
}
