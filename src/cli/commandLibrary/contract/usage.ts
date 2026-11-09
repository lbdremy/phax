import type * as Schema from "effect/Schema";
import { stdinFlagUsage } from "./catalogue.js";
import type { Command, Grouping, Inputs, Program, Source } from "./command.js";
import { argShapes, flagShapes, stdinFlagHelp, type FlagShape } from "./shapes.js";

/** What the runner says of the options it owns, once: Commander's help and the usage spec both
 *  read it, so the two never differ. */
export const OPTION_HELP = {
  json: "Answer in JSON: the output on stdout, messages as JSON lines on stderr",
  jsonSchema: "Print this command's contracts as JSON Schema, and run nothing",
  programJsonSchema: "Print the program's contracts as JSON Schema, and run nothing",
  out: "Write the document to <path> and answer the file written; - writes it to stdout",
  stdin: (flag: string): string =>
    `read the document from stdin, or from the file attached: --${flag}=<path>`,
  /** Gain carried for upstream: the help of a stdin flag whose value is required. */
  stdinValue: (flag: string): string =>
    `read the document from the file named, or from stdin when it is -: --${flag} <file|->`,
  /** Gain carried for upstream: the root `--json-schema` of a program that lists it once. */
  anyJsonSchema:
    "Print the program's contracts as JSON Schema, or a command's after its name, and run nothing",
  /** Gain carried for upstream: the program's usage flag and its format option. */
  usage: "Print the usage spec, and run nothing",
  usageFormat: "The usage spec's format: kdl",
} as const;

const KEYWORDS = new Set(["true", "false", "null", "inf", "-inf", "nan"]);

/** A KDL string: always quoted, with the escapes KDL 2 reads. */
function quoted(text: string): string {
  let out = '"';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\") out += "\\\\";
    else if (char === '"') out += '\\"';
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += `\\u{${code.toString(16)}}`;
    } else out += char;
  }
  return `${out}"`;
}

/** A KDL word: bare when KDL reads it as an identifier, else quoted. */
function word(text: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(text) && !KEYWORDS.has(text) ? text : quoted(text);
}

/** A flag's or argument's usage, bare when KDL reads it as one word (`--json`, `<id>`), else
 *  quoted (`"--mode <mode>"`, `"[note]"`). */
const usageOf = (text: string): string =>
  /^(--?[A-Za-z][A-Za-z0-9-]*|<[A-Za-z0-9_.-]+>)$/.test(text) ? text : quoted(text);

/** `key="value"` for a value, nothing for none. */
const property = (key: string, value: string | undefined): string =>
  value === undefined ? "" : ` ${key}=${quoted(value)}`;

const INDENT = "    ";

/** A node with its properties, and its children when it has any. */
function node(
  depth: number,
  head: string,
  children: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  const pad = INDENT.repeat(depth);
  return children.length === 0 ? [`${pad}${head}`] : [`${pad}${head} {`, ...children, `${pad}}`];
}

/** The `choices` child node of a flag or an argument. */
const choicesNode = (
  depth: number,
  choices: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> =>
  choices === undefined ? [] : [`${INDENT.repeat(depth)}choices ${choices.map(word).join(" ")}`];

/** One option's node; `global` for a program-wide option. */
function optionNode(flag: FlagShape, depth: number, global: boolean): ReadonlyArray<string> {
  // Gain (a short alias): `--yes -y`, as usage writes a flag's short form after its long one.
  const names = flag.alias === undefined ? `--${flag.option}` : `--${flag.option} -${flag.alias}`;
  // Gain (an option with an optional value): `--hold [selection]`.
  const usage = flag.switch
    ? names
    : flag.valueOptional
      ? `${names} [${flag.valueName}]`
      : `${names} <${flag.valueName}>`;
  return node(
    depth,
    `flag ${usageOf(usage)}${global ? " global=#true" : ""}${property("help", flag.help)}${property("default", flag.default)}${
      flag.optional || flag.switch ? "" : " required=#true"
    }`,
    choicesNode(depth + 1, flag.choices),
  );
}

function stdinNode(stdin: Source<Schema.Top>, depth: number): ReadonlyArray<string> {
  const flag = stdin.flag;
  if (flag === undefined) return [];
  const usage =
    stdin.valueRequired === true ? (stdinFlagUsage(stdin) ?? `--${flag}`) : `--${flag} [path]`;
  const help =
    stdinFlagHelp(stdin.contract) ??
    (stdin.valueRequired === true ? OPTION_HELP.stdinValue(flag) : OPTION_HELP.stdin(flag));
  return node(
    depth,
    `flag ${usageOf(usage)}${property("help", help)}${stdin.required === true ? " required=#true" : ""}`,
  );
}

function flagNodes(command: Command<unknown>, depth: number, listsJsonSchema: boolean): string[] {
  const inputs: Inputs = command.input;
  const lines: string[] = [];
  const flags = inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract);
  for (const flag of flags) lines.push(...optionNode(flag, depth, false));
  if (inputs.stdin !== undefined) lines.push(...stdinNode(inputs.stdin, depth));
  if (command.writesDocument === true) {
    lines.push(
      ...node(depth, `flag ${usageOf("--out <path>")}${property("help", OPTION_HELP.out)}`),
    );
  }
  lines.push(...node(depth, `flag --json${property("help", OPTION_HELP.json)}`));
  if (listsJsonSchema) {
    lines.push(...node(depth, `flag --json-schema${property("help", OPTION_HELP.jsonSchema)}`));
  }
  return lines;
}

function argNodes(command: Command<unknown>, depth: number): string[] {
  const inputs: Inputs = command.input;
  const args = inputs.args === undefined ? [] : argShapes(inputs.args.contract);
  // Gain (variadic arguments): `<plan>...` or `[path]...`, as usage writes one.
  return args.flatMap((arg) =>
    node(
      depth,
      `arg ${usageOf(`${arg.optional ? `[${arg.name}]` : `<${arg.name}>`}${arg.variadic ? "..." : ""}`)}${property("help", arg.help)}${property(
        "default",
        arg.default,
      )}`,
      choicesNode(depth + 1, arg.choices),
    ),
  );
}

/** The `example` child nodes of a command or a group. */
const exampleNodes = (
  depth: number,
  examples: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> =>
  (examples ?? []).flatMap((each) => node(depth, `example ${quoted(each)}`));

/** A command's block: its examples first, then its options, then its positionals. */
function commandNode(command: Command<unknown>, depth: number, listsJsonSchema: boolean): string[] {
  const examples = exampleNodes(depth + 1, command.examples);
  return [
    ...node(
      depth,
      `cmd ${word(command.name)}${property("help", command.summary)}${property("long_help", command.help)}`,
      [
        ...examples,
        ...flagNodes(command, depth + 1, listsJsonSchema),
        ...argNodes(command, depth + 1),
      ],
    ),
  ];
}

/** A command's chain of groups, outermost first. */
function chainOf(command: Command<unknown>): ReadonlyArray<Grouping> {
  const chain: Grouping[] = [];
  for (let group = command.group; group !== undefined; group = group.parent) chain.unshift(group);
  return chain;
}

/** A command, or a group with what it holds, in the order first declared. */
type Entry =
  | { readonly kind: "command"; readonly command: Command<unknown> }
  | {
      readonly kind: "group";
      readonly group: Grouping;
      readonly entries: Entry[];
    };

/** The program's commands as the tree of groups they were declared in. */
function treeOf(commands: ReadonlyArray<Command<unknown>>): ReadonlyArray<Entry> {
  const root: Entry[] = [];
  for (const command of commands) {
    let level = root;
    for (const group of chainOf(command)) {
      let found = level.find(
        (entry): entry is Extract<Entry, { kind: "group" }> =>
          entry.kind === "group" && entry.group.name === group.name,
      );
      if (found === undefined) {
        found = { kind: "group", group, entries: [] };
        level.push(found);
      }
      level = found.entries;
    }
    level.push({ kind: "command", command });
  }
  return root;
}

/** A group's block: its summary and long help (gain), its examples (gain), then its commands. */
function entryNode(entry: Entry, depth: number, writing: Writing): ReadonlyArray<string> {
  if (entry.kind === "command") return commandNode(entry.command, depth, writing.listsJsonSchema);
  const { group } = entry;
  return node(
    depth,
    `cmd ${word(group.name)}${property("help", group.summary)}${property("long_help", group.help)}${
      writing.plainGroups ? "" : " subcommand_required=#true"
    }`,
    [
      ...exampleNodes(depth + 1, group.examples),
      ...entry.entries.flatMap((each) => entryNode(each, depth + 1, writing)),
    ],
  );
}

/** How the spec writes commands and groups: where it lists `--json-schema`, and whether a group
 *  says it needs a subcommand (gain, plain groups). */
interface Writing {
  readonly listsJsonSchema: boolean;
  readonly plainGroups: boolean;
}

/** Gain carried for upstream (completers): one top-level `complete` node per distinct identifier
 *  whose element declares a completer, in declaration order. */
function completeNodes(program: Program<unknown>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const command of program.commands) {
    const inputs: Inputs = command.input;
    if (inputs.args === undefined) continue;
    for (const arg of argShapes(inputs.args.contract)) {
      if (arg.completer === undefined || seen.has(arg.name)) continue;
      seen.add(arg.name);
      lines.push(
        `complete ${quoted(arg.name)}${property("run", arg.completer.run)}${
          arg.completer.descriptions ? " descriptions=#true" : ""
        }`,
      );
    }
  }
  return lines;
}

/** The program's own flags: its usage flag (gain) or the library's hidden `--usage-spec`, its
 *  `--json-schema`, and its options (gain), global. */
function programFlags(program: Program<unknown>, listsJsonSchema: boolean): ReadonlyArray<string> {
  const lines: string[] = [];
  const usage = program.usage;
  if (usage === undefined) {
    lines.push("flag --usage-spec hide=#true");
  } else {
    // Gain (the usage flags' help): the program's own sentences and default, else the library's.
    // Gain (global usage flags): declared global when the program's edge reads them anywhere.
    const global = usage.global === true ? " global=#true" : "";
    lines.push(
      `flag ${usageOf(`--${usage.flag}`)}${global}${property("help", usage.help ?? OPTION_HELP.usage)}`,
    );
    if (usage.format !== undefined) {
      lines.push(
        `flag ${usageOf(`--${usage.format} <format>`)}${global}${property("help", usage.formatHelp ?? OPTION_HELP.usageFormat)}${property("default", usage.formatDefault ?? "kdl")}`,
      );
    }
  }
  lines.push(
    listsJsonSchema
      ? `flag --json-schema${property("help", OPTION_HELP.programJsonSchema)}`
      : `flag --json-schema global=#true${property("help", OPTION_HELP.anyJsonSchema)}`,
  );
  if (program.options !== undefined) {
    for (const flag of flagShapes(program.options.contract))
      lines.push(...optionNode(flag, 0, true));
  }
  return lines;
}

/** Gain carried for upstream (the program's exits documented): the runner's two codes, said
 *  after the root's help. */
const exitsNode = (program: Program<unknown>): string =>
  `after_long_help ${quoted(
    `Exit codes:\n  ${program.exits.refused}  refused: an unknown command, an undeclared argument or option, an input that does not decode\n  ${program.exits.defect}  defect: what no command declared, a bug`,
  )}`;

/** The program's usage spec, in KDL, the format `usage` reads (clap_usage writes the same): the
 *  program's name, binary and version, then each command with its summary, long help, examples,
 *  options (`--json` and `--json-schema` on every one) and positionals by name; a group is a
 *  command that needs a subcommand and holds its commands. Written from the definitions alone.
 *
 *  Gains carried for upstream: the program's exits after its help, its usage flag, `--json-schema`
 *  listed once at the root when the program says so, its options as global flags, the arguments'
 *  completers as `complete` nodes, groups nested in groups, the root's `license`,
 *  `min_usage_version` and `about` after its version, the usage flags' own help and default, and
 *  groups written plain, without `subcommand_required`. */
export function usageSpec(program: Program<unknown>): string {
  const listsJsonSchema = (program.usage?.jsonSchema ?? "every-command") === "every-command";
  const writing: Writing = { listsJsonSchema, plainGroups: program.usage?.groups === "plain" };
  const minUsageVersion = program.usage?.minUsageVersion;
  const lines: string[] = [
    `name ${word(program.name)}`,
    `bin ${word(program.name)}`,
    `version ${quoted(program.version)}`,
    // Gain (the usage header): in the order usage's own specs write them.
    ...(program.license === undefined ? [] : [`license ${quoted(program.license)}`]),
    ...(minUsageVersion === undefined ? [] : [`min_usage_version ${quoted(minUsageVersion)}`]),
    ...(program.summary === undefined ? [] : [`about ${quoted(program.summary)}`]),
    exitsNode(program),
    ...programFlags(program, listsJsonSchema),
    ...completeNodes(program),
    ...treeOf(program.commands).flatMap((entry) => entryNode(entry, 0, writing)),
  ];
  return `${lines.join("\n")}\n`;
}
