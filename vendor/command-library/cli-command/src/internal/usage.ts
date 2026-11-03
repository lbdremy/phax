import type { Command, Inputs, Program } from "../contracts/command.ts";
import { argShapes, flagShapes } from "./shapes.ts";

/** What the runner says of the options it owns, once: Commander's help and the usage spec both
 *  read it, so the two never differ. */
export const OPTION_HELP = {
  json: "Answer in JSON: the output on stdout, messages as JSON lines on stderr",
  jsonSchema: "Print this command's contracts as JSON Schema, and run nothing",
  programJsonSchema:
    "Print the program's contracts as JSON Schema, and run nothing",
  out: "Write the document to <path> and answer the file written; - writes it to stdout",
  stdin: (flag: string): string =>
    `read the document from stdin, or from the file attached: --${flag}=<path>`,
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
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(text) && !KEYWORDS.has(text)
    ? text
    : quoted(text);
}

/** A flag's or argument's usage, bare when KDL reads it as one word (`--json`, `<id>`), else
 *  quoted (`"--mode <mode>"`, `"[note]"`). */
const usageOf = (text: string): string =>
  /^(--?[A-Za-z][A-Za-z0-9-]*|<[A-Za-z0-9_.-]+>)$/.test(text)
    ? text
    : quoted(text);

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
  return children.length === 0
    ? [`${pad}${head}`]
    : [`${pad}${head} {`, ...children, `${pad}}`];
}

/** The `choices` child node of a flag or an argument. */
const choicesNode = (
  depth: number,
  choices: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> =>
  choices === undefined
    ? []
    : [`${INDENT.repeat(depth)}choices ${choices.map(word).join(" ")}`];

function flagNodes(command: Command<unknown>, depth: number): string[] {
  const inputs: Inputs = command.input;
  const lines: string[] = [];
  const flags =
    inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract);
  for (const flag of flags) {
    const usage = flag.switch
      ? `--${flag.option}`
      : `--${flag.option} <${flag.field}>`;
    lines.push(
      ...node(
        depth,
        `flag ${usageOf(usage)}${property("help", flag.help)}${property("default", flag.default)}${
          flag.optional || flag.switch ? "" : " required=#true"
        }`,
        choicesNode(depth + 1, flag.choices),
      ),
    );
  }
  const stdin = inputs.stdin;
  if (stdin?.flag !== undefined) {
    lines.push(
      ...node(
        depth,
        `flag ${usageOf(`--${stdin.flag} [path]`)}${property(
          "help",
          OPTION_HELP.stdin(stdin.flag),
        )}${stdin.required === true ? " required=#true" : ""}`,
      ),
    );
  }
  if (command.writesDocument === true) {
    lines.push(
      ...node(
        depth,
        `flag ${usageOf("--out <path>")}${property("help", OPTION_HELP.out)}`,
      ),
    );
  }
  lines.push(
    ...node(depth, `flag --json${property("help", OPTION_HELP.json)}`),
    ...node(
      depth,
      `flag --json-schema${property("help", OPTION_HELP.jsonSchema)}`,
    ),
  );
  return lines;
}

function argNodes(command: Command<unknown>, depth: number): string[] {
  const inputs: Inputs = command.input;
  const args = inputs.args === undefined ? [] : argShapes(inputs.args.contract);
  return args.flatMap((arg) =>
    node(
      depth,
      `arg ${usageOf(arg.optional ? `[${arg.name}]` : `<${arg.name}>`)}${property("help", arg.help)}${property(
        "default",
        arg.default,
      )}`,
      choicesNode(depth + 1, arg.choices),
    ),
  );
}

/** A command's block: its examples first, then its options, then its positionals. */
function commandNode(command: Command<unknown>, depth: number): string[] {
  const examples = (command.examples ?? []).flatMap((each) =>
    node(depth + 1, `example ${quoted(each)}`),
  );
  return [
    ...node(
      depth,
      `cmd ${word(command.name)}${property("help", command.summary)}${property("long_help", command.help)}`,
      [
        ...examples,
        ...flagNodes(command, depth + 1),
        ...argNodes(command, depth + 1),
      ],
    ),
  ];
}

/** The program's usage spec, in KDL, the format `usage` reads (clap_usage writes the same): the
 *  program's name, binary and version, then each command with its summary, long help, examples,
 *  options (`--json` and `--json-schema` on every one) and positionals by name; a group is a
 *  command that needs a subcommand and holds its commands. Written from the definitions alone. */
export function usageSpec(program: Program<unknown>): string {
  const lines: string[] = [
    `name ${word(program.name)}`,
    `bin ${word(program.name)}`,
    `version ${quoted(program.version)}`,
    "flag --usage-spec hide=#true",
    `flag --json-schema${property("help", OPTION_HELP.programJsonSchema)}`,
  ];
  const seen = new Set<string>();
  for (const command of program.commands) {
    if (command.group === undefined) {
      lines.push(...commandNode(command, 0));
      continue;
    }
    const group = command.group;
    if (seen.has(group.name)) continue;
    seen.add(group.name);
    const members = program.commands.filter(
      (candidate) => candidate.group?.name === group.name,
    );
    lines.push(
      ...node(
        0,
        `cmd ${word(group.name)}${property("help", group.summary)} subcommand_required=#true`,
        members.flatMap((member) => commandNode(member, 1)),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
