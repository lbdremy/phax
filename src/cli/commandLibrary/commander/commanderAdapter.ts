// The only file of the port that imports `commander`: the adapter builds a fresh Commander tree
// for one call, parses the words and hands back what Commander said. The runner reads the call's
// words itself first; Commander matches the command, enforces arity, and writes help.
import { Command, CommanderError } from "commander";
import { OPTION_HELP } from "../contract/index.js";

/** What the adapter shows of an argument or an option: its help, its choices and its default.
 *  Shown only: Commander enforces none of them, the contract's decode does. */
interface Described {
  readonly help: string | undefined;
  readonly choices: ReadonlyArray<string> | undefined;
  readonly default: string | undefined;
}

/** A group as the adapter declares it: its word and its summary, and (gain) its long help and
 *  examples, shown in its help after the summary and before its commands. */
export interface GroupSpec {
  readonly name: string;
  readonly summary: string;
  readonly help?: string | undefined;
  readonly examples?: ReadonlyArray<string> | undefined;
}

/** What the adapter declares to Commander for one command. */
export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  /** A longer help, shown after the summary on the command's own `--help`. */
  readonly help?: string | undefined;
  /** Command lines shown in an `Examples:` block after the options. */
  readonly examples?: ReadonlyArray<string> | undefined;
  /** The groups the command is declared under, outermost first; none for a command alone.
   *  Gain carried for upstream (groups holding groups): a chain of any depth. */
  readonly groups: ReadonlyArray<GroupSpec>;
  /** One positional argument per tuple element, under its name; the rest (gain) is variadic. */
  readonly args: ReadonlyArray<
    Described & { readonly name: string; readonly optional: boolean; readonly variadic: boolean }
  >;
  /** One option per field: `--kebab <value name>`, or a bare switch. */
  readonly flags: ReadonlyArray<
    Described & {
      readonly field: string;
      readonly option: string;
      readonly valueName: string;
      readonly optional: boolean;
      readonly switch: boolean;
      /** Gain (a short alias): the option's letter, declared as `-y, --yes`. */
      readonly alias?: string | undefined;
    }
  >;
  /** What the command reads on stdin, when it declares a read: JSON, or text (gain). */
  readonly stdin: "json" | "text" | undefined;
  /** The flag the stdin read is bound to, shown in help only: the runner reads it before Commander
   *  sees the words. `valueRequired` (gain) shows it as `--flag <file|->`. */
  readonly stdinFlag?: { readonly name: string; readonly valueRequired: boolean } | undefined;
  /** The command writes a document: its `--out <path>` is declared, for help only. */
  readonly writesDocument?: boolean | undefined;
  /** The variable names of the env contract, when the command declares env. */
  readonly env: ReadonlyArray<string> | undefined;
}

/** A root option, declared for help only: the runner reads it before Commander sees the words. */
export interface RootOption {
  readonly flags: string;
  readonly help: string;
}

export interface ProgramSpec {
  readonly name: string;
  readonly version: string;
  readonly commands: ReadonlyArray<CommandSpec>;
  /** The program's own options (`--json-schema`, its usage flag, its options for every command),
   *  shown in the root's help. */
  readonly rootOptions: ReadonlyArray<RootOption>;
}

export interface TerminalSpec {
  readonly columns: number;
  readonly color: boolean;
}

/** Commander's help or version, to write to `out`. */
interface Shown {
  readonly tag: "Shown";
  readonly text: string;
}

/** Commander's refusal, to write to `err`: an unknown command, a missing argument or option, an
 *  unknown option, or the help of a call that names a group (or nothing) and no command. */
interface Refused {
  readonly tag: "Refused";
  readonly text: string;
}

/** A command matched: every operand as a string, and the options given, by field name, as
 *  strings or Booleans. Nothing is defaulted. `command` is its full name, its words joined by
 *  a space. */
interface Matched {
  readonly tag: "Matched";
  readonly command: string;
  readonly operands: ReadonlyArray<string>;
  readonly options: Readonly<Record<string, string | boolean>>;
}

export type ParseResult = Shown | Refused | Matched;

const camelCase = (kebab: string): string =>
  kebab.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** A switch Commander reads as negated: `no-probe`, whose attribute is `probe`. */
const NEGATED = /^no-(.+)$/;

/** The help line of an argument or an option: its help, then its choices and its default the way
 *  Commander writes them. Nothing when there is none. */
function describing(shown: Described): string {
  const parts: string[] = [];
  if (shown.help !== undefined) parts.push(shown.help);
  if (shown.choices !== undefined) {
    parts.push(`(choices: ${shown.choices.map((c) => JSON.stringify(c)).join(", ")})`);
  }
  if (shown.default !== undefined) {
    parts.push(`(default: ${JSON.stringify(shown.default)})`);
  }
  return parts.join(" ");
}

/** The command's full name, its words joined by a space: what a match answers. */
const keyOf = (spec: CommandSpec): string =>
  [...spec.groups.map((group) => group.name), spec.name].join(" ");

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
    command.summary(spec.summary).description(`${spec.summary}\n\n${spec.help}`);
  }
  for (const arg of spec.args) {
    const name = arg.variadic ? `${arg.name}...` : arg.name;
    command.argument(arg.optional ? `[${name}]` : `<${name}>`, describing(arg));
  }
  for (const flag of spec.flags) {
    const names =
      flag.alias === undefined ? `--${flag.option}` : `-${flag.alias}, --${flag.option}`;
    const flags = flag.switch ? names : `${names} <${flag.valueName}>`;
    if (flag.optional) command.option(flags, describing(flag));
    else command.requiredOption(flags, describing(flag));
  }
  const stdinFlag = spec.stdinFlag;
  if (stdinFlag !== undefined) {
    if (stdinFlag.valueRequired) {
      command.option(`--${stdinFlag.name} <file|->`, OPTION_HELP.stdinValue(stdinFlag.name));
    } else {
      command.option(`--${stdinFlag.name} [path]`, OPTION_HELP.stdin(stdinFlag.name));
    }
  }
  // The runner owns these and reads them from the words before Commander sees any: they are
  // declared here for help alone.
  if (spec.writesDocument === true) {
    command.option("--out <path>", OPTION_HELP.out);
  }
  command.option("--json", OPTION_HELP.json);
  command.option("--json-schema", OPTION_HELP.jsonSchema);
  if (spec.stdin !== undefined) {
    command.addHelpText("after", `\nstdin: ${spec.stdin === "text" ? "text" : "JSON"}`);
  }
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
      // Fix: Commander keeps a negated switch, `--no-probe`, under its positive attribute
      // (`probe`), true by default and false when given. The field (`noProbe`) is true when the
      // switch is given and absent otherwise.
      const negated = flag.switch ? NEGATED.exec(flag.option)?.[1] : undefined;
      if (negated !== undefined) {
        if (given[camelCase(negated)] === false) options[flag.field] = true;
        continue;
      }
      const value = given[camelCase(flag.option)];
      if (value !== undefined) options[flag.field] = value;
    }
    matched.current = {
      tag: "Matched",
      command: keyOf(spec),
      operands: command.args,
      options,
    };
  });
}

/** A group's description: its summary alone, or (gain) its summary, then its long help, then its
 *  examples indented two spaces, which its help shows before its commands. The parent's list says
 *  the summary. */
function describeGroup(node: Command, group: GroupSpec): void {
  const parts = [group.summary];
  if (group.help !== undefined) parts.push(group.help);
  if (group.examples !== undefined && group.examples.length > 0) {
    parts.push(`Examples:\n${group.examples.map((each) => `  ${each}`).join("\n")}`);
  }
  if (parts.length === 1) node.description(group.summary);
  else node.summary(group.summary).description(parts.join("\n\n"));
}

/** Builds a fresh Commander tree for one call and parses the words, which are the call's arguments
 *  after the executable and the script. Commander never reads the process, never exits and never
 *  writes: its output is collected and handed back.
 *
 *  Gain carried for upstream (groups holding groups): one Commander node per group, at any depth,
 *  declared where its first command stands; a group called alone writes its help on stderr. */
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
    });
  for (const option of program.rootOptions) root.option(option.flags, option.help);
  // A group is a command of its own with what it holds under it, keyed by its full name.
  const groups = new Map<string, Command>();
  for (const spec of program.commands) {
    let parent = root;
    const path: string[] = [];
    for (const group of spec.groups) {
      path.push(group.name);
      const key = path.join(" ");
      let node = groups.get(key);
      if (node === undefined) {
        node = parent.command(group.name).helpCommand(false);
        describeGroup(node, group);
        groups.set(key, node);
      }
      parent = node;
    }
    declare(parent, spec, matched);
  }
  try {
    root.parse(words, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? { tag: "Shown", text: out } : { tag: "Refused", text: err };
    }
    throw error;
  }
  return matched.current ?? { tag: "Refused", text: err };
}
