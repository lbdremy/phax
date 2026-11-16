// The argument vectors of the CLI-argument property. Every value is `{ origin, argv, stdin }`:
// `origin` names the source that drew it, so a failure says which kind of call broke the runner.
//
// Two kinds of argv: arbitrary strings (`anyArgv`), and the program's own words followed by
// arbitrary flags and values (`knownArgv`). The words are read from the program at run time,
// through the contract's `fullName`, `flagShapes` and `argShapes`: the functions `usageSpec`
// writes from. A new command in the program is covered without editing this file.
// The imports obey the argv import rule: the contract's index, nothing else under `src/cli/`.
import fc from "fast-check";
import {
  argShapes,
  flagShapes,
  fullName,
  type Command,
  type Grouping,
  type Inputs,
  type Program,
} from "../../../src/cli/commandLibrary/contract/index.js";
import { TRIGGER_WORDS } from "./argvProgram.js";

/** The source of an argv: `any-strings` and `option-like` are arbitrary; `known` is a full command
 *  path then arbitrary tokens; `known-retired` is a group's words then a word it retired;
 *  `known-root` is a call of the root's own words (the usage flag, the version, `help`, the
 *  program's options). */
type ArgvOrigin = "any-strings" | "option-like" | "known" | "known-retired" | "known-root";

/** What the property hands the runner: the call's words, and what stdin holds. */
export interface ArgvCase {
  readonly origin: ArgvOrigin;
  readonly argv: ReadonlyArray<string>;
  readonly stdin: string;
}

/** An option as the person types it: `--name`, its alias `-x` when it has one, and how it reads a
 *  value. */
interface OptionWord {
  readonly long: string;
  readonly alias: string | undefined;
  readonly takesValue: boolean;
}

interface CommandWords {
  /** The command's full name: its groups' names, then its own. */
  readonly path: ReadonlyArray<string>;
  /** Its options, and the flag a stdin read is bound to. */
  readonly options: ReadonlyArray<OptionWord>;
  /** Its retired options, as `--name`. */
  readonly retiredOptions: ReadonlyArray<string>;
  /** How many positional arguments it declares. */
  readonly arguments: number;
}

interface GroupWords {
  readonly path: ReadonlyArray<string>;
  readonly retired: ReadonlyArray<string>;
}

/** Every word of a program a call may name, read from the program. */
export interface ArgvVocabulary {
  readonly commands: ReadonlyArray<CommandWords>;
  readonly groups: ReadonlyArray<GroupWords>;
  /** The program's options, for every command. */
  readonly programOptions: ReadonlyArray<OptionWord>;
  /** The usage flag and its format option, as `--name`. */
  readonly usage: ReadonlyArray<string>;
  /** The version's forms: `--version`, and `-<letter>` when the program declares one. */
  readonly version: ReadonlyArray<string>;
  readonly helpCommand: boolean;
}

const optionWords = (flags: ReturnType<typeof flagShapes>): ReadonlyArray<OptionWord> =>
  flags.map((flag) => ({
    long: `--${flag.option}`,
    alias: flag.alias === undefined ? undefined : `-${flag.alias}`,
    takesValue: !flag.switch,
  }));

/** The program's words: each command's full path, options (`--name`, `-x`), retired options and
 *  argument count; the groups' paths and retired words; the program's options, usage flag, format
 *  option and version forms. */
export function argvVocabulary(program: Program<unknown>): ArgvVocabulary {
  const groups = new Map<string, GroupWords>();
  const commands = program.commands.map((command: Command<unknown>): CommandWords => {
    const inputs: Inputs = command.input;
    const path = fullName(command);
    const chain: Grouping[] = [];
    for (let group = command.group; group !== undefined; group = group.parent) chain.unshift(group);
    chain.forEach((group, index) => {
      const names = chain.slice(0, index + 1).map((each) => each.name);
      groups.set(names.join(" "), { path: names, retired: Object.keys(group.retired ?? {}) });
    });
    const flag = inputs.stdin?.flag;
    return {
      path,
      options: [
        ...(inputs.flags === undefined ? [] : optionWords(flagShapes(inputs.flags.contract))),
        ...(flag === undefined ? [] : [{ long: `--${flag}`, alias: undefined, takesValue: true }]),
      ],
      retiredOptions: Object.keys(command.retiredOptions ?? {}).map((name) => `--${name}`),
      arguments: inputs.args === undefined ? 0 : argShapes(inputs.args.contract).length,
    };
  });
  const usage = program.usage;
  return {
    commands,
    groups: [...groups.values()],
    programOptions:
      program.options === undefined ? [] : optionWords(flagShapes(program.options.contract)),
    usage:
      usage === undefined
        ? []
        : [`--${usage.flag}`, ...(usage.format === undefined ? [] : [`--${usage.format}`])],
    version: [
      "--version",
      ...(program.versionAlias === undefined ? [] : [`-${program.versionAlias}`]),
    ],
    helpCommand: program.helpCommand === true,
  };
}

// --- Pieces ------------------------------------------------------------------------------------

/** The tokens `anyArgv` draws its second kind from. */
const OPTION_LIKE = [
  "-",
  "--",
  "--x=",
  "-abc",
  "--help",
  "--json",
  "--json-schema",
  "--version",
  "-V",
  "help",
] as const;

const unicode = fc.string({ unit: "grapheme", maxLength: 12 });

const triggerWord = fc.constantFrom(...Object.values(TRIGGER_WORDS));

/** A value for an option or an operand: arbitrary, numeric, empty, leading with a dash, or one of
 *  the words the program reads (`TRIGGER_WORDS`), without which no call reaches a verdict code or
 *  a check's refusal. */
const value: fc.Arbitrary<string> = fc.oneof(
  unicode,
  fc.integer({ min: -1000, max: 1000 }).map(String),
  fc.double().map(String),
  fc.constant(""),
  fc.string({ maxLength: 8 }).map((text) => `-${text}`),
  triggerWord,
);

const optionLike = fc.constantFrom(...OPTION_LIKE);

/** What stdin holds: nothing, a JSON document of the JSON stdin command, a text document, or
 *  garbage. */
const stdin: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.array(fc.string({ maxLength: 6 }), { maxLength: 3 }).map((todos) => JSON.stringify({ todos })),
  unicode,
  fc.constantFrom("{", "[1,", "null", '{"todos": 3}', "\u0000"),
);

const withStdin = (
  origin: ArgvOrigin,
  argv: fc.Arbitrary<ReadonlyArray<string>>,
): fc.Arbitrary<ArgvCase> => fc.record({ origin: fc.constant(origin), argv, stdin });

/** Arrays of 0 to 6 arbitrary Unicode strings, and arrays drawn from an alphabet of option-like
 *  tokens. */
export function anyArgv(): fc.Arbitrary<ArgvCase> {
  return fc.oneof(
    withStdin("any-strings", fc.array(unicode, { maxLength: 6 })),
    withStdin("option-like", fc.array(optionLike, { maxLength: 6 })),
  );
}

/** An option given as the call may write it: bare, with a separate value, with `=value`, or by its
 *  alias. */
const optionTokens = (option: OptionWord): fc.Arbitrary<ReadonlyArray<string>> =>
  fc.oneof(
    fc.constant([option.long]),
    value.map((text) => [option.long, text]),
    value.map((text) => [`${option.long}=${text}`]),
    ...(option.alias === undefined
      ? []
      : [fc.constant([option.alias]), value.map((text) => [option.alias as string, text])]),
  );

/** The tokens after a command's path: what a person may write after it, right or wrong. */
function tokensAfter(
  command: CommandWords,
  programOptions: ReadonlyArray<OptionWord>,
): fc.Arbitrary<ReadonlyArray<string>> {
  const given = [...command.options, ...programOptions];
  const tokens: fc.Arbitrary<ReadonlyArray<string>>[] = [
    // a known option, or the program's
    ...(given.length === 0 ? [] : [fc.constantFrom(...given).chain(optionTokens)]),
    ...(command.retiredOptions.length === 0
      ? []
      : [fc.constantFrom(...command.retiredOptions).map((option) => [option])]),
    // an unknown option
    fc.stringMatching(/^[a-z-]{1,8}$/).map((name) => [`--${name}`]),
    fc.constantFrom(["-z"], ["-q", "x"]),
    // operands, as many as the command declares and one more
    fc.array(value, { maxLength: command.arguments + 1 }),
    // `--` followed by option-like words, which are operands then
    fc.array(fc.oneof(optionLike, value), { maxLength: 3 }).map((words) => ["--", ...words]),
    fc.constantFrom(["--help"], ["--json"], ["--json-schema"]),
  ];
  const any = fc
    .array(fc.oneof(...tokens), { maxLength: 6 })
    .map((groups) => groups.flat().slice(0, 6));
  // Now and then one word the program reads, alone: among arbitrary tokens, a verdict code or a
  // check's refusal is almost never reached, as some other token is refused first.
  return command.arguments === 0
    ? any
    : fc.oneof(
        { weight: 3, arbitrary: any },
        { weight: 1, arbitrary: triggerWord.map((word) => [word]) },
      );
}

/** A call of the root's own words: the usage flag and its format, the version, the program's
 *  options and `help` with a command's path. */
function rootCalls(vocabulary: ArgvVocabulary): fc.Arbitrary<ReadonlyArray<string>> | undefined {
  const heads = [
    ...vocabulary.usage,
    ...vocabulary.version,
    ...vocabulary.programOptions.map((option) => option.long),
  ];
  const calls: fc.Arbitrary<ReadonlyArray<string>>[] = [];
  if (heads.length > 0) {
    calls.push(
      fc
        .tuple(
          fc.constantFrom(...heads),
          fc.array(fc.oneof(fc.constantFrom(...heads), value, optionLike), { maxLength: 3 }),
        )
        .map(([head, rest]) => [head, ...rest]),
    );
  }
  const [flag, format] = vocabulary.usage;
  if (flag !== undefined && format !== undefined) {
    calls.push(
      fc.constantFrom(
        [flag, format, "kdl"],
        [format, "kdl", flag],
        [`${format}=kdl`, flag],
        [flag, format],
        [flag, `${format}=json`],
        [format, "kdl"],
      ),
    );
  }
  if (vocabulary.helpCommand) {
    calls.push(
      fc.constantFrom(
        ["help"],
        ...vocabulary.commands.map((command) => ["help", ...command.path]),
        ...vocabulary.groups.map((group) => ["help", ...group.path]),
      ),
    );
  }
  return calls.length === 0 ? undefined : fc.oneof(...calls);
}

/** A group's words then a word it retired, then a few tokens. */
function retiredCalls(vocabulary: ArgvVocabulary): fc.Arbitrary<ReadonlyArray<string>> | undefined {
  const calls = vocabulary.groups.flatMap((group) =>
    group.retired.map((word) => [...group.path, word]),
  );
  if (calls.length === 0) return undefined;
  return fc
    .tuple(fc.constantFrom(...calls), fc.array(fc.oneof(optionLike, value), { maxLength: 2 }))
    .map(([call, rest]) => [...call, ...rest]);
}

/** A full command path of the program, then 0 to 6 tokens; now and then a call of the root's own
 *  words, or of a group's retired word. */
export function knownArgv(program: Program<unknown>): fc.Arbitrary<ArgvCase> {
  const vocabulary = argvVocabulary(program);
  const known = fc
    .constantFrom(...vocabulary.commands)
    .chain((command) =>
      tokensAfter(command, vocabulary.programOptions).map((tokens) => [...command.path, ...tokens]),
    );
  const root = rootCalls(vocabulary);
  const retired = retiredCalls(vocabulary);
  return fc.oneof(
    { weight: 8, arbitrary: withStdin("known", known) },
    ...(root === undefined ? [] : [{ weight: 1, arbitrary: withStdin("known-root", root) }]),
    ...(retired === undefined
      ? []
      : [{ weight: 1, arbitrary: withStdin("known-retired", retired) }]),
  );
}
