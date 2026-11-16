// The program the CLI-argument property runs the command library's runner over. It is built with
// the contract's define API (`defineProgram`, `defineGroup`, `defineCommand`), not taken from the
// conformance suite, whose programs are private to `cases.ts`, one per case, and frozen.
//
// The program offers every reading path of the runner that a call can reach through the in-memory
// `Io` with a synchronous run, and `PROGRAM_SHAPES` names each of them, checked by name. What it
// leaves out, on purpose:
// - `writesDocument` and `--out`: a successful write hashes with WebCrypto, asynchronously, and the
//   property runs the runner synchronously;
// - `handsOver` and `prompts`: a command that hands the terminal over, or asks a person, has no
//   in-memory answer;
// - a command whose run dies or fails with a tag it does not map, a `render` or a `notes` that
//   throws, a tag or a verdict mapped to the refused or the defect code: each is a defect by
//   design, and the runner refuses a program that maps one of those codes (`misdeclared`).
// The imports obey the argv import rule: the contract's index, nothing else under `src/cli/`.
import { Data, Effect, Result } from "effect";
import * as Schema from "effect/Schema";
import {
  AliasAnnotationId,
  OptionalValueAnnotationId,
  Refused,
  argShapes,
  defineCommand,
  defineGroup,
  defineProgram,
  flagShapes,
  fullName,
  reject,
  strip,
  type Command,
  type Inputs,
  type Program,
} from "../../../src/cli/commandLibrary/contract/index.js";

/** The code the program's guard refuses `guarded` with: neither the refused nor the defect code. */
export const ARGV_GUARD_EXIT = 65;

const REFUSED = 64;
const DEFECT = 70;
const GONE_EXIT = 4;

class Gone extends Data.TaggedError("Gone")<{ readonly id: string }> {}

const Str = Schema.String;
const Switch = Schema.optionalKey(Schema.Boolean);
const Doc = Schema.Struct({ todos: Schema.Array(Str) });

/** A switch with a one-letter alias: `--verbose` or `-v`. */
const Verbose = Switch.annotateKey({ description: "Say more", [AliasAnnotationId]: "v" });
/** A value flag with a one-letter alias: `--mode <mode>` or `-m <mode>`. */
const Mode = Schema.optionalKey(Str).annotateKey({ [AliasAnnotationId]: "m" });
/** A flag whose value may be left out: bare, it decodes to `true`. */
const Hold = Schema.optionalKey(Schema.Union([Schema.Literal(true), Str])).annotateKey({
  identifier: "selection",
  [OptionalValueAnnotationId]: true,
});
/** A flag whose value decodes to a number; a value that reads as none is refused. */
const Count = Schema.optionalKey(Schema.FiniteFromString);

/** A command whose run succeeds with its own name, rendered as it is. */
const plain = (name: string, input: Inputs): Command<never> =>
  defineCommand({
    name,
    summary: `the ${name} command`,
    input,
    output: strip(Str),
    exits: {},
    run: () => Effect.succeed(name),
    render: (text) => text,
  });

const pair = plain("pair", { args: reject(Schema.Tuple([Str, Str])) });
const maybe = plain("maybe", { args: reject(Schema.Tuple([Str, Schema.optionalKey(Str)])) });
const many = plain("many", { args: reject(Schema.Array(Str)) });
const options = plain("options", {
  flags: reject(Schema.Struct({ verbose: Verbose, mode: Mode, hold: Hold, count: Count })),
});
const measure = plain("measure", {
  flags: reject(Schema.Struct({ limit: Schema.FiniteFromString })),
});
const lenient = plain("lenient", {
  args: strip(Schema.Tuple([Str])),
  flags: strip(Schema.Struct({ to: Schema.optionalKey(Str) })),
});
const ingest = plain("ingest", { stdin: reject(Doc) });
const note = plain("note", { stdin: reject(Str, { text: true }) });
const load = plain("load", { stdin: reject(Doc, { flag: "document", valueRequired: true }) });
const fromEnv = plain("from-env", {
  env: reject(Schema.Struct({ PROP_PROFILE: Schema.optionalKey(Str) })),
});
const legacy = defineCommand({
  name: "legacy",
  summary: "the legacy command",
  input: { flags: reject(Schema.Struct({ keep: Switch })) },
  output: strip(Str),
  exits: {},
  retiredOptions: { "skip-check": "--skip-check is no longer read: write --keep" },
  run: () => Effect.succeed("legacy"),
  render: (text) => text,
});
const guarded = plain("guarded", { args: reject(Schema.Tuple([Schema.optionalKey(Str)])) });

/** Answers its argument; `bad` exits 1 and `warn` exits 2, as verdicts, with a note on `warn`. */
const verdict = defineCommand({
  name: "verdict",
  summary: "the verdict command",
  input: { args: reject(Schema.Tuple([Schema.optionalKey(Str)])) },
  output: strip(Str),
  exits: {},
  verdicts: { 1: (value) => value === "bad", 2: (value) => value === "warn" },
  run: (context) => context.progress("checking").pipe(Effect.as(context.input.args[0] ?? "ok")),
  render: (text) => text,
  notes: (value) => (value === "warn" ? "warned" : ""),
});

/** Fails with a tag its `exits` maps. */
const fail = defineCommand({
  name: "fail",
  summary: "the fail command",
  input: {},
  output: strip(Str),
  exits: { Gone: GONE_EXIT },
  run: () => Effect.fail(new Gone({ id: "x" })),
  render: (text) => text,
});

/** Its `check` refuses the argument `bad` and lets any other through. */
const refuse = defineCommand({
  name: "refuse",
  summary: "the refuse command",
  input: { args: reject(Schema.Tuple([Schema.optionalKey(Str)])) },
  output: strip(Str),
  exits: {},
  check: ({ input }) =>
    input.args[0] === "bad"
      ? Effect.fail(
          new Refused({
            source: "args",
            path: ["arg0"],
            expected: "an argument that is not bad",
            text: "error: arg0 is bad",
          }),
        )
      : Effect.void,
  run: () => Effect.succeed("refuse"),
  render: (text) => text,
});

const store = defineGroup({
  name: "store",
  summary: "The store",
  retired: { purge: "store purge is retired: use store list" },
  commands: [
    plain("list", { args: reject(Schema.Tuple([Schema.optionalKey(Str)])) }),
    defineGroup({
      name: "deep",
      summary: "A group in a group",
      retired: { obsolete: "store deep obsolete is retired: use store deep leaf" },
      commands: [plain("leaf", { flags: reject(Schema.Struct({ verbose: Verbose })) })],
    }),
  ],
});

/** The program: its commands and groups, in the order declared. */
export function argvProgram(): Program<never> {
  return defineProgram({
    name: "prop",
    version: "1.2.3",
    summary: "The property program",
    versionAlias: "V",
    helpCommand: true,
    guard: (call) =>
      call.words.join(" ") === "guarded"
        ? { text: "prop guarded is not allowed here", exit: ARGV_GUARD_EXIT }
        : undefined,
    exits: { refused: REFUSED, defect: DEFECT },
    usage: { flag: "usage", format: "usage-format" },
    options: reject(Schema.Struct({ trace: Switch, profile: Schema.optionalKey(Str) })),
    refusalHint: "Run `prop --help` for usage.",
    commands: [
      pair,
      maybe,
      many,
      options,
      measure,
      lenient,
      ingest,
      note,
      load,
      fromEnv,
      store,
      legacy,
      guarded,
      verdict,
      fail,
      refuse,
    ],
  });
}

// --- What the program offers ------------------------------------------------------------------

const inputsOf = (command: Command<unknown>): Inputs => command.input;
const flagsOf = (command: Command<unknown>) => {
  const { flags } = inputsOf(command);
  return flags === undefined ? [] : flagShapes(flags.contract);
};
const argsOf = (command: Command<unknown>) => {
  const { args } = inputsOf(command);
  return args === undefined ? [] : argShapes(args.contract);
};
const anyCommand = (
  program: Program<unknown>,
  holds: (command: Command<unknown>) => boolean,
): boolean => program.commands.some(holds);

/** Whether a command's flag named `field` decodes "7" to a number and refuses "x". */
const numericFlag = (command: Command<unknown>): boolean => {
  const { flags } = inputsOf(command);
  if (flags === undefined) return false;
  return Object.entries(flags.contract.fields).some(([field, schema]) => {
    const decode = Schema.decodeUnknownResult(
      Schema.make<Schema.Codec<unknown>>(Schema.Struct({ [field]: schema }).ast),
    );
    const seven = decode({ [field]: "7" });
    return (
      Result.isSuccess(seven) &&
      typeof seven.success === "object" &&
      seven.success !== null &&
      typeof Reflect.get(seven.success, field) === "number" &&
      Result.isFailure(decode({ [field]: "x" }))
    );
  });
};

const policyOf = (command: Command<unknown>): ReadonlyArray<string> => {
  const { args, flags, stdin, env } = inputsOf(command);
  return [args, flags, stdin, env].flatMap((source) =>
    source === undefined ? [] : [source.undeclared],
  );
};

const groupings = (command: Command<unknown>) => {
  const chain = [];
  for (let group = command.group; group !== undefined; group = group.parent) chain.push(group);
  return chain;
};

/** One runner path the program must offer: its kebab-case `name`, the one-line `reason` naming the
 *  runner branch it reaches, and `holds`, which inspects the program through the contract's
 *  exports. A path the program stops offering fails the test of its name. */
interface ProgramShape {
  readonly name: string;
  readonly reason: string;
  readonly holds: (program: Program<unknown>) => boolean;
}

/** The closed list of paths the program offers, in the order the reading meets them. */
export const PROGRAM_SHAPES: ReadonlyArray<ProgramShape> = [
  {
    name: "positional-arguments",
    reason: "precheck reads operands against a command's required positional shapes",
    holds: (program) => anyCommand(program, (c) => argsOf(c).some((a) => !a.optional)),
  },
  {
    name: "optional-argument",
    reason: "an optional positional is absent without a refusal, present decoded",
    holds: (program) =>
      anyCommand(program, (c) => argsOf(c).some((a) => a.optional && !a.variadic)),
  },
  {
    name: "variadic-argument",
    reason: "precheck counts no surplus operand once an argument takes every operand left",
    holds: (program) => anyCommand(program, (c) => argsOf(c).some((a) => a.variadic)),
  },
  {
    name: "switch-flag",
    reason: "readWords takes a switch without a value, and refuses one given `=value`",
    holds: (program) => anyCommand(program, (c) => flagsOf(c).some((f) => f.switch)),
  },
  {
    name: "value-flag",
    reason: "readWords takes the next word as the value, or reports it missing",
    holds: (program) =>
      anyCommand(program, (c) => flagsOf(c).some((f) => !f.switch && !f.valueOptional)),
  },
  {
    name: "required-flag",
    reason: "a flag the contract requires is refused at the decode when it is absent",
    holds: (program) =>
      anyCommand(program, (c) => flagsOf(c).some((f) => !f.switch && !f.optional)),
  },
  {
    name: "short-alias",
    reason: "readWords reads `-x` as the option it is the alias of, never with `=`",
    holds: (program) => anyCommand(program, (c) => flagsOf(c).some((f) => f.alias !== undefined)),
  },
  {
    name: "optional-value-flag",
    reason: "readWords reads a bare flag with no missing value, and one given a value",
    holds: (program) => anyCommand(program, (c) => flagsOf(c).some((f) => f.valueOptional)),
  },
  {
    name: "numeric-flag",
    reason: "a flag value that decodes to a number runs, one that does not is refused",
    holds: (program) => anyCommand(program, numericFlag),
  },
  {
    name: "strip-policy",
    reason: "a source that strips drops the undeclared words instead of refusing them",
    holds: (program) => anyCommand(program, (c) => policyOf(c).includes("strip")),
  },
  {
    name: "reject-policy",
    reason: "a source that rejects refuses an undeclared option, argument or key",
    holds: (program) => anyCommand(program, (c) => policyOf(c).includes("reject")),
  },
  {
    name: "json-stdin",
    reason: "readDocument reads stdin and parses it as JSON, refusing what is not",
    holds: (program) =>
      anyCommand(program, (c) => {
        const { stdin } = inputsOf(c);
        return stdin !== undefined && stdin.text !== true && stdin.flag === undefined;
      }),
  },
  {
    name: "text-stdin",
    reason: "a text document is handed to its contract as read, without a JSON parse",
    holds: (program) => anyCommand(program, (c) => inputsOf(c).stdin?.text === true),
  },
  {
    name: "stdin-flag",
    reason: "takeFlag reads a flag bound to stdin: `-`, a path attached or spaced, or none",
    holds: (program) => anyCommand(program, (c) => inputsOf(c).stdin?.flag !== undefined),
  },
  {
    name: "env-source",
    reason: "the environment is decoded as a source, with the declared keys",
    holds: (program) => anyCommand(program, (c) => inputsOf(c).env !== undefined),
  },
  {
    name: "nested-group",
    reason: "locate walks a group held in a group, and refuses a group called alone",
    holds: (program) => anyCommand(program, (c) => groupings(c).length >= 2),
  },
  {
    name: "group-retired-word",
    reason: "locate refuses a word a group retired with the sentence that names its replacement",
    holds: (program) =>
      anyCommand(program, (c) => groupings(c).some((g) => Object.keys(g.retired ?? {}).length > 0)),
  },
  {
    name: "command-retired-option",
    reason: "precheck refuses a retired option with its own sentence, before any decode",
    holds: (program) => anyCommand(program, (c) => Object.keys(c.retiredOptions ?? {}).length > 0),
  },
  {
    name: "program-options",
    reason: "takeProgramOptions reads the program's options wherever they stand",
    holds: (program) =>
      program.options !== undefined && flagShapes(program.options.contract).length > 0,
  },
  {
    name: "usage-flag",
    reason: "usageCall answers the usage flag alone, and refuses it beside any other word",
    holds: (program) => program.usage !== undefined,
  },
  {
    name: "usage-format",
    reason: "usageCall reads the format option, spaced or attached, and refuses any but kdl",
    holds: (program) => program.usage?.format !== undefined,
  },
  {
    name: "version-alias",
    reason: "precheck answers `-V` alone as the version, as `--version` is",
    holds: (program) => program.versionAlias !== undefined,
  },
  {
    name: "help-command",
    reason: "asHelp reads `help [words]` as `[words] --help` while the program names no `help`",
    holds: (program) =>
      program.helpCommand === true && !program.commands.some((c) => fullName(c)[0] === "help"),
  },
  {
    name: "guard-exit",
    reason: "guarded refuses one command with the guard's own code, not the refused one",
    holds: (program) =>
      program.guard !== undefined &&
      anyCommand(
        program,
        (c) => program.guard?.({ words: fullName(c), options: {} })?.exit === ARGV_GUARD_EXIT,
      ),
  },
  {
    name: "verdict-code",
    reason: "verdictOf exits the first code whose predicate holds for a successful output",
    holds: (program) => anyCommand(program, (c) => Object.keys(c.verdicts ?? {}).length > 0),
  },
  {
    name: "mapped-error-tag",
    reason: "outcomeOf exits the code a command's `exits` maps to the tag its run failed with",
    holds: (program) => anyCommand(program, (c) => Object.keys(c.exits).length > 0),
  },
  {
    name: "check-refusal",
    reason: "checkThenExecute writes a `Refused` of a command's check as a refusal, before run",
    holds: (program) => anyCommand(program, (c) => c.check !== undefined),
  },
];

/** The exit codes the program declares: 0, every command's `exits`, every verdict code and the
 *  guard's code. The program's `refused` code is not among them: the property checks it through
 *  the refusal contract, and the defect code is never one a call may end with unless a bug did. */
export function declaredExitCodes(program: Program<unknown>): ReadonlySet<number> {
  const codes = new Set<number>([0, ARGV_GUARD_EXIT]);
  for (const command of program.commands) {
    const exits: Readonly<Record<string, number>> = command.exits;
    for (const code of Object.values(exits)) codes.add(code);
    for (const code of Object.keys(command.verdicts ?? {})) codes.add(Number(code));
  }
  return codes;
}
