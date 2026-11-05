import { Cause, Data, Effect, Either, Option } from "effect";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import {
  catalogue,
  commandContract,
  encodedText,
  fullName,
  messages,
  OPTION_HELP,
  Refused,
  stdinFlagHelp,
  usageSpec,
  written,
  type Command,
  type ErrorText,
  type ExitCode,
  type FlagShape,
  type Grouping,
  type Inputs,
  type Io,
  type Program,
  type ProgramUsage,
  type RunContext,
  type Runner,
  type Source,
  type StdinDocument,
} from "../contract/index.js";
import {
  parseCall,
  type CommandSpec,
  type GroupSpec,
  type ProgramSpec,
  type RootOption,
} from "./commanderAdapter.js";
import {
  defectLine,
  detailsOf,
  JSON_SCHEMA_OPTION,
  noteLines,
  OUT_OPTION,
  outcomeLine,
  pathOf,
  refusedLine,
  RESERVED,
  takeOut,
  takeReserved,
  USAGE_SPEC_OPTION,
  type Details,
  type Out,
} from "./json.js";
import { declaredOf, defectText, outcomeOf } from "./outcome.js";
import { argShapes, flagShapes } from "./shape.js";
import { readDocument, takeFlag, type Document } from "./stdin.js";
import { suggestSimilar } from "./suggest.js";
import {
  END_OF_OPTIONS,
  HELP,
  isOption,
  readWords,
  takeProgramOptions,
  VERSION,
  type ProgramWords,
} from "./undeclared.js";

/** A failure of the output's reduction: a defect, with its text for `err`. */
class Defect extends Data.TaggedError("Defect")<{
  readonly text: string;
}> {}

/** A call the runner will not run. Its text is what `err` receives; the rest is what the
 *  `refused` line of `--json` says. */
class Refusal extends Data.TaggedError("Refusal")<{
  readonly text: string;
  readonly source: Details["source"];
  readonly path: Details["path"];
  readonly expected: string;
}> {}

/** A call read and decoded, ready to run. */
interface Ready<R> {
  readonly tag: "Ready";
  readonly command: Command<R>;
  readonly input: Readonly<Record<string, unknown>>;
  /** The program's options, decoded (gain): `{}` when the program declares none. */
  readonly program: Readonly<Record<string, unknown>>;
  /** `--out`, for a command that writes a document. */
  readonly out: Out;
  /** The stdin document as read (gain), when one was read. */
  readonly document: StdinDocument | undefined;
}

/** Commander's help or version: the call ends here, with 0. */
interface Displayed {
  readonly tag: "Displayed";
  readonly text: string;
}

const line = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`);

const refusal = (text: string, details: Details): Refusal =>
  new Refusal({ text: line(text), ...details });

/** A command's chain of groups, outermost first. */
function chainOf(command: Command<unknown>): ReadonlyArray<Grouping> {
  const chain: Grouping[] = [];
  for (let group = command.group; group !== undefined; group = group.parent) chain.unshift(group);
  return chain;
}

function specOf(command: Command<unknown>): CommandSpec {
  const inputs: Inputs = command.input;
  const stdin = inputs.stdin;
  return {
    name: command.name,
    summary: command.summary,
    help: command.help,
    examples: command.examples,
    groups: chainOf(command).map(
      (group): GroupSpec => ({
        name: group.name,
        summary: group.summary,
        help: group.help,
        examples: group.examples,
      }),
    ),
    args: inputs.args === undefined ? [] : argShapes(inputs.args.contract),
    flags: inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract),
    stdin: stdin === undefined ? undefined : stdin.text === true ? "text" : "json",
    stdinFlag:
      stdin?.flag === undefined
        ? undefined
        : {
            name: stdin.flag,
            valueRequired: stdin.valueRequired === true,
            help: stdinFlagHelp(stdin.contract),
          },
    writesDocument: command.writesDocument === true,
    env: inputs.env === undefined ? undefined : Object.keys(inputs.env.contract.fields),
  };
}

/** The root's own options, for its help, in the order root help lists them (gain, root help):
 *  the program's options for every command (gain), the usage flag and its format option (gain),
 *  with their help and the format's default, then `--json-schema`. The version comes before them
 *  and the help after, as Commander writes them. The runner reads each before Commander does. */
function rootOptionsOf(program: Program<unknown>): ReadonlyArray<RootOption> {
  const options: RootOption[] = [];
  if (program.options !== undefined) {
    for (const flag of flagShapes(program.options.contract)) {
      options.push({
        flags: flag.switch
          ? `--${flag.option}`
          : flag.valueOptional
            ? `--${flag.option} [${flag.valueName}]`
            : `--${flag.option} <${flag.valueName}>`,
        help: flag.help ?? "",
      });
    }
  }
  const usage = program.usage;
  if (usage !== undefined) {
    options.push({ flags: `--${usage.flag}`, help: usage.help ?? OPTION_HELP.usage });
    if (usage.format !== undefined) {
      options.push({
        flags: `--${usage.format} <format>`,
        help: usage.formatHelp ?? OPTION_HELP.usageFormat,
        default: usage.formatDefault,
      });
    }
  }
  options.push({
    flags: JSON_SCHEMA_OPTION,
    help:
      program.usage?.jsonSchema === "program"
        ? OPTION_HELP.anyJsonSchema
        : OPTION_HELP.programJsonSchema,
  });
  return options;
}

/** Gain (the version's short form): the version's forms, `--version` and its letter when the
 *  program declares one. */
const versionsOf = (program: Program<unknown>): ReadonlyArray<string> =>
  program.versionAlias === undefined ? [VERSION] : [VERSION, `-${program.versionAlias}`];

/** Gain (the root's help command): the word `help` is the help command's when the program asks
 *  for one and declares no command or group of that name. */
const HELP_WORD = "help";
const hasHelpCommand = (program: Program<unknown>): boolean =>
  program.helpCommand === true &&
  !program.commands.some((command) => fullName(command)[0] === HELP_WORD);

function programSpecOf(program: Program<unknown>): ProgramSpec {
  return {
    name: program.name,
    version: program.version,
    summary: program.summary,
    versionFlags:
      program.versionAlias === undefined ? undefined : `-${program.versionAlias}, ${VERSION}`,
    helpCommand: hasHelpCommand(program),
    commands: program.commands.map(specOf),
    rootOptions: rootOptionsOf(program),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A contract's schema as the runner decodes and encodes with it: a source's contract needs no
 *  service, which `Schema.Schema.Any` cannot say (it leaves the context open). */
const synchronous = (contract: Schema.Schema.Any): Schema.Schema<unknown, unknown, never> =>
  contract as unknown as Schema.Schema<unknown, unknown, never>;

/** The policy a source declares, as Effect 3's parse option. */
const policyOf = (source: Source<Schema.Schema.Any>) =>
  ({
    onExcessProperty: source.undeclared === "reject" ? "error" : "ignore",
  }) as const;

/** Why a decode failed, on one line: the first issue's place, as the call writes it, and what
 *  Effect 3's `ParseResult.ArrayFormatter` says of it. */
function reasonOf(
  kind: Details["source"],
  failure: ParseResult.ParseError,
  names: ReadonlyArray<string>,
): string {
  const first = ParseResult.ArrayFormatter.formatErrorSync(failure)[0];
  if (first === undefined) return failure.message;
  const path = pathOf(kind, first.path, names);
  return path.length === 0 ? first.message : `${path.join(".")}: ${first.message}`;
}

/** Decodes one source's value with its policy applied literally, with Effect 3's
 *  `Schema.decodeUnknownEither`. */
function decode(
  label: string,
  kind: Details["source"],
  source: Source<Schema.Schema.Any>,
  value: unknown,
  names: ReadonlyArray<string> = [],
): Effect.Effect<unknown, Refusal> {
  const decoded = Schema.decodeUnknownEither(synchronous(source.contract), policyOf(source))(value);
  if (Either.isRight(decoded)) return Effect.succeed(decoded.right);
  const failure = decoded.left;
  const excess = source.undeclared === "reject" ? excessKeys(source.contract, value) : [];
  const why =
    excess.length > 0 ? `undeclared ${excess.join(", ")}` : reasonOf(kind, failure, names);
  return Effect.fail(
    refusal(`error: ${label} does not decode: ${why}`, detailsOf(kind, failure, names)),
  );
}

/** The object node of a contract's encoded side, under its refinements and transformations. */
function objectOf(ast: SchemaAST.AST): SchemaAST.TypeLiteral | undefined {
  if (SchemaAST.isTypeLiteral(ast)) return ast;
  if (SchemaAST.isRefinement(ast) || SchemaAST.isTransformation(ast)) return objectOf(ast.from);
  return undefined;
}

/** The keys of `value` that the contract does not declare, for `err` to name. */
function excessKeys(contract: Schema.Schema.Any, value: unknown): ReadonlyArray<string> {
  const ast = objectOf(SchemaAST.encodedAST(contract.ast));
  if (ast === undefined || !isRecord(value)) return [];
  const declared = ast.propertySignatures.map((property) => String(property.name));
  return Object.keys(value).filter((key) => !declared.includes(key));
}

function parseJson(document: Document): Effect.Effect<unknown, Refusal> {
  return Effect.try({
    try: (): unknown => JSON.parse(document.text),
    catch: () =>
      refusal(`error: ${document.label} is not JSON`, {
        source: "stdin",
        path: [],
        expected: "JSON",
      }),
  });
}

/** What Commander's refusal says, read from its text. */
function commanderDetails(text: string): Details {
  const argument = /missing required argument '([^']+)'/.exec(text);
  if (argument !== null) {
    return { source: "args", path: [argument[1] ?? ""], expected: "a value" };
  }
  const option = /required option '(--[^\s']+)/.exec(text);
  if (option !== null) {
    return { source: "flags", path: [option[1] ?? ""], expected: "a value" };
  }
  const unknownOption = /unknown option '([^']+)'/.exec(text);
  if (unknownOption !== null) {
    // Port change for phax's spec (command-contracts §5.8): an option no contract declares is
    // named without its dashes, `colour` for `--colour`, as a declared field is.
    return {
      source: "flags",
      path: [(unknownOption[1] ?? "").replace(/^-+/, "")],
      expected: "a declared option",
    };
  }
  const unknownCommand = /unknown command '([^']+)'/.exec(text);
  if (unknownCommand !== null) {
    return {
      source: "command",
      path: [unknownCommand[1] ?? ""],
      expected: "a command of the program",
    };
  }
  return { source: "command", path: [], expected: "a command" };
}

/** One reason a call is refused before Commander reads it. */
interface Problem {
  readonly text: string;
  readonly details: Details;
}

type Words = ReadonlyArray<string>;

/** A command, or a group with what it holds, in the order first declared. */
type Entry<R> =
  | { readonly kind: "command"; readonly command: Command<R> }
  | {
      readonly kind: "group";
      readonly name: string;
      /** What the group says of itself: its retired words (gain) among it. */
      readonly grouping: Grouping;
      readonly entries: Entry<R>[];
    };

/** The program's commands as the tree of groups they were declared in. */
function treeOf<R>(program: Program<R>): ReadonlyArray<Entry<R>> {
  const root: Entry<R>[] = [];
  for (const command of program.commands) {
    let level = root;
    for (const group of chainOf(command)) {
      let found = level.find(
        (entry): entry is Extract<Entry<R>, { kind: "group" }> =>
          entry.kind === "group" && entry.name === group.name,
      );
      if (found === undefined) {
        found = { kind: "group", name: group.name, grouping: group, entries: [] };
        level.push(found);
      }
      level = found.entries;
    }
    level.push({ kind: "command", command });
  }
  return root;
}

/** What the first words of a call name: nothing, an option, a command (alone or under its
 *  groups), a group with no command under it, or a word that names none. `rest` is every word
 *  after the ones that named it. */
type Located<R> =
  | { readonly tag: "Bare" }
  | { readonly tag: "Option"; readonly name: string; readonly rest: Words }
  | {
      readonly tag: "Command";
      readonly command: Command<R>;
      readonly path: ReadonlyArray<string>;
      readonly rest: Words;
    }
  | { readonly tag: "Group"; readonly path: ReadonlyArray<string>; readonly rest: Words }
  /** Gain (a group's retired words): a group's words, then a word it retired. */
  | {
      readonly tag: "Retired";
      readonly path: ReadonlyArray<string>;
      readonly sentence: string;
    }
  | {
      readonly tag: "Unknown";
      readonly word: string;
      readonly known: ReadonlyArray<string>;
    };

const entryName = <R>(entry: Entry<R>): string =>
  entry.kind === "command" ? entry.command.name : entry.name;

/** Reads the call's first words against the program's tree: `<command>`, `<group>… <command>`, a
 *  group alone at any depth, or a word that is none of them. */
function locate<R>(program: Program<R>, argv: Words): Located<R> {
  let level = treeOf(program);
  const path: string[] = [];
  let words = argv;
  let within: Grouping | undefined;
  for (;;) {
    const [head, ...rest] = words;
    if (head === undefined) {
      return path.length === 0 ? { tag: "Bare" } : { tag: "Group", path, rest: [] };
    }
    if (isOption(head)) {
      return path.length === 0
        ? { tag: "Option", name: head, rest }
        : { tag: "Group", path, rest: words };
    }
    const command = level.find(
      (entry): entry is Extract<Entry<R>, { kind: "command" }> =>
        entry.kind === "command" && entry.command.name === head,
    );
    if (command !== undefined) {
      return { tag: "Command", command: command.command, path: [...path, head], rest };
    }
    const group = level.find(
      (entry): entry is Extract<Entry<R>, { kind: "group" }> =>
        entry.kind === "group" && entry.name === head,
    );
    if (group === undefined) {
      // Gain (a group's retired words): a word the group retired is refused with its sentence.
      const retired = within?.retired;
      if (retired !== undefined && Object.hasOwn(retired, head)) {
        return { tag: "Retired", path: [...path, head], sentence: retired[head] ?? "" };
      }
      return { tag: "Unknown", word: head, known: [...new Set(level.map(entryName))] };
    }
    path.push(head);
    level = group.entries;
    within = group.grouping;
    words = rest;
  }
}

/** Why a call is refused before Commander reads it: the call as a whole, then each word after
 *  the command's name. Help and the version are answered only where §5.31 and §5.32 answer them;
 *  before `--`, every word that starts with `-` is an option (§4), and after it none is.
 *  `kept` are the words after the command's name that the runner did not take itself. */
function precheck<R>(
  program: Program<R>,
  located: Located<R>,
  kept: Words,
): { readonly words: ReadonlyArray<string> } | Refusal {
  if (located.tag === "Bare") return { words: [] };
  if (located.tag === "Option") {
    const name = located.name;
    const rest = located.rest;
    // Gain (the version's short form): `-V` alone is the version too, when the program says so.
    const alone = HELP.includes(name) || versionsOf(program).includes(name);
    if (rest.length === 0 && alone) {
      return { words: [name] };
    }
    return refusal(
      alone
        ? `error: ${name} is answered alone: ${program.name} ${name}`
        : `error: unknown option '${name}'`,
      {
        source: "command",
        path: [name],
        expected: alone ? `${name} alone` : "a command",
      },
    );
  }
  if (located.tag === "Unknown") {
    return refusal(
      `error: unknown command '${located.word}'${suggestSimilar(located.word, located.known)}`,
      {
        source: "command",
        path: [located.word],
        expected: `one of ${located.known.join(", ")}`,
      },
    );
  }
  // Gain (a group's retired words): the sentence that names the word's replacement.
  if (located.tag === "Retired") {
    return refusal(located.sentence, {
      source: "command",
      path: located.path,
      expected: `a command of ${located.path.slice(0, -1).join(" ")}`,
    });
  }
  // A group alone is Commander's: its help on stderr, refused. Its own help is Commander's too.
  if (located.tag === "Group") return { words: [...located.path, ...kept] };
  const { command, path } = located;
  const inputs: Inputs = command.input;
  const read = readWords(
    kept,
    inputs.flags === undefined
      ? []
      : flagShapes(inputs.flags.contract).map((flag) => ({
          option: flag.option,
          takesValue: !flag.switch,
          alias: flag.alias,
          valueOptional: flag.valueOptional,
        })),
  );
  if (read.help) return { words: [...path, "--help"] };
  // Gain (a command's retired options): a retired option is refused with its own sentence, alone,
  // before anything is decoded.
  const retiredOptions = command.retiredOptions;
  if (retiredOptions !== undefined) {
    for (const word of read.undeclared) {
      const name = (word.split("=")[0] ?? "").replace(/^--/, "");
      if (word.startsWith("--") && Object.hasOwn(retiredOptions, name)) {
        return refusal(retiredOptions[name] ?? "", {
          source: "flags",
          path: [name],
          expected: "no such option",
        });
      }
    }
  }
  const problems: Problem[] = [];
  if (read.version) {
    problems.push({
      text: `error: ${VERSION} is answered alone: ${program.name} ${VERSION}`,
      details: {
        source: "command",
        path: [VERSION],
        expected: `${VERSION} alone`,
      },
    });
  }
  if (inputs.flags?.undeclared !== "strip") {
    const known = [
      ...(inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract)),
      ...(program.options === undefined ? [] : flagShapes(program.options.contract)),
    ].flatMap((flag) =>
      flag.alias === undefined ? [`--${flag.option}`] : [`--${flag.option}`, `-${flag.alias}`],
    );
    known.push("--json", "--json-schema", "--help");
    for (const option of read.undeclared) {
      problems.push({
        text: `error: unknown option '${option}'${suggestSimilar(option, known)}`,
        // Port change (command-contracts §5.8): the option named without its dashes.
        details: {
          source: "flags",
          path: [option.replace(/^-+/, "")],
          expected: "a declared option",
        },
      });
    }
  }
  if (read.valueMissing !== undefined) {
    const shapes = inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract);
    problems.push({
      text: `error: option '${withValueName(read.valueMissing, shapes)}' argument missing`,
      details: {
        source: "flags",
        path: [read.valueMissing],
        expected: "a value",
      },
    });
  }
  const shapes = inputs.args === undefined ? [] : argShapes(inputs.args.contract);
  const given = shapes.length;
  // Gain (variadic arguments): a variadic argument takes every operand left, so none is surplus.
  const surplus = shapes.some((shape) => shape.variadic) ? [] : read.operands.slice(given);
  if (surplus.length > 0 && inputs.args?.undeclared !== "strip") {
    problems.push({
      text: `error: too many arguments: ${surplus.join(" ")}`,
      details: {
        source: "args",
        path: [`arg${given}`],
        expected: `at most ${given} argument${given === 1 ? "" : "s"}`,
      },
    });
  }
  const first = problems[0];
  return first === undefined
    ? { words: [...path, ...read.kept] }
    : new Refusal({
        text: problems.map((problem) => line(problem.text)).join(""),
        ...first.details,
      });
}

function prepare<R>(
  program: Program<R>,
  io: Io,
  located: Located<R>,
  given: ProgramWords,
): Effect.Effect<Ready<R> | Displayed, Refusal> {
  return Effect.gen(function* () {
    if (given.valueMissing !== undefined) {
      const shapes = program.options === undefined ? [] : flagShapes(program.options.contract);
      return yield* refusal(
        `error: option '${withValueName(given.valueMissing, shapes)}' argument missing`,
        {
          source: "flags",
          path: [given.valueMissing],
          expected: "a value",
        },
      );
    }
    const known = located.tag === "Command" ? located.command : undefined;
    const words = located.tag === "Command" || located.tag === "Group" ? located.rest : [];
    // The runner reads `--out`, and the flag a stdin read is bound to, itself, before Commander
    // sees the words.
    const writes = known?.writesDocument === true;
    const outTaken = writes ? takeOut(words) : { kept: words, out: { tag: "Absent" } as Out };
    const stdinSource = known?.input.stdin as Source<Schema.Schema.Any> | undefined;
    const flag = stdinSource?.flag;
    const taken =
      flag === undefined
        ? { kept: outTaken.kept, reading: { tag: "Absent" } as const }
        : takeFlag(outTaken.kept, flag, stdinSource?.valueRequired === true);
    const checked = precheck(program, located, taken.kept);
    if (checked instanceof Refusal) return yield* checked;
    const out = outTaken.out;
    if (out.tag === "Missing") {
      return yield* refusal(`error: option '${out.word}' argument missing`, {
        source: "flags",
        path: [OUT_OPTION],
        expected: "a path, or - for the standard output",
      });
    }
    const parsed = parseCall(programSpecOf(program), checked.words, io.terminal);
    if (parsed.tag === "Shown") {
      return { tag: "Displayed", text: parsed.text } as const;
    }
    if (parsed.tag === "Refused") {
      return yield* new Refusal({
        text: parsed.text,
        ...commanderDetails(parsed.text),
      });
    }
    const command = program.commands.find(
      (candidate) => fullName(candidate).join(" ") === parsed.command,
    );
    if (command === undefined) {
      return yield* refusal(`error: unknown command '${parsed.command}'`, {
        source: "command",
        path: [parsed.command],
        expected: "a command of the program",
      });
    }
    const declared: Inputs = command.input;
    const input: Record<string, unknown> = {};
    let read: StdinDocument | undefined;

    const shapes = declared.args === undefined ? [] : argShapes(declared.args.contract);
    if (declared.args !== undefined) {
      // Gain (variadic arguments): the rest takes every operand left, each named by it.
      const variadic = shapes.some((shape) => shape.variadic);
      const operands = variadic ? parsed.operands : parsed.operands.slice(0, shapes.length);
      const names = variadic
        ? operands.map((_, index) => shapes[Math.min(index, shapes.length - 1)]?.name ?? "")
        : shapes.map((shape) => shape.name);
      input["args"] = yield* decode("args", "args", declared.args, operands, names);
    }
    if (declared.flags !== undefined) {
      input["flags"] = yield* decode("flags", "flags", declared.flags, parsed.options);
    }
    if (declared.stdin !== undefined) {
      const stdin: Source<Schema.Schema.Any> = declared.stdin;
      const document = yield* readDocument(
        io,
        fullName(command).join(" "),
        stdin,
        taken.reading,
      ).pipe(
        Effect.mapError((failure) =>
          refusal(failure.text, {
            source: "stdin",
            path: failure.path,
            expected: failure.expected,
          }),
        ),
      );
      // Gain (the document as read): run is handed it beside its decoded form.
      read = document === undefined ? undefined : { origin: document.origin, text: document.text };
      // Gain (a text stdin document): a text document is handed to its contract as read.
      input["stdin"] =
        document === undefined
          ? undefined
          : yield* decode(
              document.label,
              "stdin",
              stdin,
              stdin.text === true ? document.text : yield* parseJson(document),
            );
    }
    if (declared.env !== undefined) {
      const env = Object.fromEntries(
        Object.entries(io.env).filter(([, value]) => value !== undefined),
      );
      input["env"] = yield* decode("env", "env", declared.env, env);
    }
    // Gain (options for every command): decoded once, for the command's run.
    const options =
      program.options === undefined
        ? {}
        : yield* decode("options", "flags", program.options, given.options);
    return {
      tag: "Ready",
      command,
      input,
      program: isRecord(options) ? options : {},
      out,
      document: read,
    } as const;
  });
}

function describe(cause: Cause.Cause<unknown>): string {
  return defectText(Cause.pretty(cause));
}

/** Encodes `run`'s value with the output contract and its policy, with Effect 3's
 *  `Schema.encodeUnknownEither`: the output's encoded form. A failure is a defect. */
function encode(output: Source<Schema.Schema.Any>, value: unknown): Effect.Effect<unknown, Defect> {
  const encoded = Schema.encodeUnknownEither(synchronous(output.contract), policyOf(output))(value);
  return Either.isLeft(encoded)
    ? Effect.fail(new Defect({ text: defectText(encoded.left.message) }))
    : Effect.succeed(encoded.right);
}

/** Decodes an encoded output back: the reduced value `render`, `notes` and the verdicts
 *  receive. A failure is a defect. */
function reduced(
  output: Source<Schema.Schema.Any>,
  encoded: unknown,
): Effect.Effect<unknown, Defect> {
  const decoded = Schema.decodeUnknownEither(
    synchronous(output.contract),
    policyOf(output),
  )(encoded);
  return Either.isLeft(decoded)
    ? Effect.fail(new Defect({ text: defectText(decoded.left.message) }))
    : Effect.succeed(decoded.right);
}

/** Gain carried for upstream (verdict codes): the first code, ascending, whose predicate holds
 *  for the reduced output; 0 when none does. */
function verdictOf(
  verdicts: Readonly<Record<number, (value: unknown) => boolean>>,
  view: unknown,
): ExitCode {
  const codes = Object.keys(verdicts)
    .map(Number)
    .toSorted((a, b) => a - b);
  for (const code of codes) {
    const holds = verdicts[code];
    if (holds !== undefined && holds(view)) return code;
  }
  return 0;
}

/** What the call writes: stdout, and stderr as it is written (text, or message lines), and the
 *  code it ends with: 0, or a verdict code (gain). */
interface Presented {
  readonly out: string;
  readonly err: string;
  readonly code: ExitCode;
}

/** What the value `run` succeeded with becomes. Without `--json`: a document's bytes, else the
 *  rendered text when the command has a render, else the output's encoded form, then the notes as
 *  text. With it: a document's bytes, else the encoded form, never the render, then one `written`
 *  line for each file beside a document and one `note` line for each line of notes. A command that
 *  writes a document and is given `--out <path>` writes it there and answers the record. */
function compose<R>(
  io: Io,
  command: Command<R>,
  value: unknown,
  json: boolean,
  out: Out,
): Effect.Effect<Presented, Defect | Refusal> {
  return Effect.gen(function* () {
    const output: Source<Schema.Schema.Any> | undefined = command.output;
    const render: ((value: unknown, terminal: Io["terminal"]) => string) | undefined =
      command.render;
    const notes: ((value: unknown, terminal: Io["terminal"]) => string) | undefined = command.notes;
    const verdicts: Readonly<Record<number, (value: unknown) => boolean>> | undefined =
      command.verdicts;
    const documentOf = command.document;
    // A document is asked for first, of the value `run` succeeded with: an answer that is a
    // document is never encoded with the output contract, nor rendered. A port change for phax's
    // `ls --complete`, whose completion lines are a text document beside the run list.
    const document =
      documentOf === undefined ? undefined : yield* Effect.sync(() => documentOf(value));
    const encoded =
      output === undefined || document !== undefined ? undefined : yield* encode(output, value);
    const needsView =
      document === undefined &&
      (notes !== undefined ||
        verdicts !== undefined ||
        (!json && (render !== undefined || command.handsOver !== undefined)));
    const view: unknown =
      output === undefined || !needsView ? value : yield* reduced(output, encoded);
    const toPath = command.writesDocument === true && out.tag === "Path" ? out.path : undefined;
    let stdout = "";
    if (document !== undefined) {
      const bytes =
        typeof document.bytes === "string"
          ? new TextEncoder().encode(document.bytes)
          : document.bytes;
      if (toPath !== undefined) {
        const path = toPath;
        yield* io.writeFile(path, bytes).pipe(
          Effect.mapError((why) =>
            refusal(`error: ${OUT_OPTION}: ${path}: ${why}`, {
              source: "flags",
              path: [OUT_OPTION],
              expected: "a writable path",
            }),
          ),
        );
        stdout = encodedText(yield* written(path, bytes));
      } else {
        stdout =
          typeof document.bytes === "string"
            ? document.bytes
            : yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      }
    } else if (toPath !== undefined) {
      return yield* new Defect({
        text: line(
          `defect: ${command.name} writes a document, and answered none for ${OUT_OPTION}`,
        ),
      });
    } else if (!json && render !== undefined) {
      // Gain (an empty render): the empty text writes nothing, not even a newline.
      const rendered = yield* Effect.sync(() => render(view, io.terminal));
      stdout = rendered === "" ? "" : `${rendered}\n`;
    } else if (output !== undefined) {
      stdout = encodedText(encoded);
    }
    const said = notes === undefined ? "" : yield* Effect.sync(() => notes(view, io.terminal));
    const err = json
      ? (document?.written ?? []).map(messages.written).join("") + noteLines(said)
      : said === ""
        ? ""
        : line(said);
    // Gain (a handed-over exit): without `--json`, the code of the process the command handed the
    // terminal to, whatever it is, in place of a verdict.
    const handsOver: ((value: unknown) => ExitCode) | undefined = command.handsOver;
    const code =
      !json && handsOver !== undefined
        ? yield* Effect.sync(() => handsOver(view))
        : verdicts === undefined
          ? 0
          : yield* Effect.sync(() => verdictOf(verdicts, view));
    return { out: stdout, err, code };
  });
}

const defectOut = (
  io: Io,
  program: Program<unknown>,
  json: boolean,
  text: string,
): Effect.Effect<ExitCode> =>
  io
    .err(json ? defectLine(text, program.exits.defect) : text)
    .pipe(Effect.as(program.exits.defect));

const refusedOut = (
  io: Io,
  program: Program<unknown>,
  json: boolean,
  refused: Refusal,
): Effect.Effect<ExitCode> =>
  io
    .err(
      json
        ? refusedLine(
            {
              source: refused.source,
              path: refused.path,
              expected: refused.expected,
            },
            refused.text,
            program.exits.refused,
          )
        : program.refusalHint === undefined
          ? refused.text
          : `${refused.text}${line(program.refusalHint)}`,
    )
    .pipe(Effect.as(program.exits.refused));

/** The value `run` succeeded with, composed and written, ending with its verdict code (gain), or
 *  0. `out` is written before the notes. */
function present<R>(
  program: Program<R>,
  io: Io,
  ready: Ready<R>,
  value: unknown,
  json: boolean,
): Effect.Effect<ExitCode> {
  return compose(io, ready.command, value, json, ready.out).pipe(
    Effect.flatMap((presented) =>
      Effect.gen(function* () {
        if (presented.out !== "") yield* io.out(presented.out);
        if (presented.err !== "") yield* io.err(presented.err);
        return presented.code;
      }),
    ),
    Effect.catchAllCause((cause) => {
      const failure = Cause.squash(cause);
      if (failure instanceof Refusal) {
        return refusedOut(io, program, json, failure);
      }
      return defectOut(
        io,
        program,
        json,
        failure instanceof Defect ? failure.text : describe(cause),
      );
    }),
  );
}

/** Gain carried for upstream (a declared error's text form): the sentence the command's `texts`
 *  says for the error that ended its run, when it declares one. */
function sentenceOf<R>(
  command: Command<R>,
  cause: Cause.Cause<unknown>,
): (() => ErrorText) | undefined {
  const declared = declaredOf(command, cause);
  if (declared === undefined) return undefined;
  const texts: Readonly<Record<string, ((error: never) => ErrorText) | undefined>> | undefined =
    command.texts;
  const say = texts?.[declared.tag];
  return say === undefined ? undefined : () => say(declared.error as never);
}

/** An option missing its value as its usage writes it, `--plan <path>`, as Commander named it. */
function withValueName(word: string, shapes: ReadonlyArray<FlagShape>): string {
  const flag = shapes.find(
    (shape) =>
      `--${shape.option}` === word || (shape.alias !== undefined && `-${shape.alias}` === word),
  );
  return flag === undefined || flag.switch ? word : `${word} <${flag.valueName}>`;
}

function execute<R>(
  program: Program<R>,
  io: Io,
  ready: Ready<R>,
  json: boolean,
): Effect.Effect<ExitCode, never, R> {
  // Gain carried for upstream (progress notes): each note is written at once, while `run` runs.
  // Gain carried for upstream (stdout progress): a person's line on stdout, a note under `--json`.
  const context: RunContext<Inputs> = {
    input: ready.input,
    progress: (text) => {
      const note = json ? noteLines(text) : text === "" ? "" : line(text);
      return note === "" ? Effect.void : io.err(note);
    },
    say: (text) => {
      if (text === "") return Effect.void;
      return json ? io.err(noteLines(text)) : io.out(line(text));
    },
    document: ready.document,
    program: ready.program,
  };
  return Effect.suspend(() => ready.command.run(context)).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => {
        const outcome = outcomeOf(program, ready.command, cause);
        if (!json) {
          const sentence = sentenceOf(ready.command, cause);
          if (sentence === undefined) return io.err(outcome.text).pipe(Effect.as(outcome.code));
          return Effect.sync(sentence).pipe(
            Effect.flatMap((text) =>
              typeof text === "string"
                ? io.err(line(text))
                : Effect.zipRight(
                    text.out === "" ? Effect.void : io.out(`${text.out}\n`),
                    io.err(line(text.err)),
                  ),
            ),
            Effect.as(outcome.code),
          );
        }
        const answer = outcomeLine(outcome, program.exits.defect);
        return io.err(answer.line).pipe(Effect.as(answer.code));
      },
      onSuccess: (value: unknown) => present(program, io, ready, value, json),
    }),
    Effect.catchAllCause((cause) => defectOut(io, program, json, describe(cause))),
  );
}

/** The first command, in program order, that maps a tag to the program's defect code. */
function collision<R>(program: Program<R>): string | undefined {
  for (const command of program.commands) {
    const exits: Readonly<Record<string, ExitCode>> = command.exits;
    const tag = Object.keys(exits).find((key) => exits[key] === program.exits.defect);
    if (tag !== undefined) {
      return line(
        `error: ${fullName(command).join(" ")} maps ${tag} to ${program.exits.defect}, the program's defect code`,
      );
    }
  }
  return undefined;
}

/** Gain carried for upstream (verdict codes): the first command, in program order, that answers
 *  0, the program's `refused` or its `defect` code as a verdict, each of which means something
 *  else to a caller. */
function verdictCollision<R>(program: Program<R>): string | undefined {
  const meanings: ReadonlyArray<readonly [ExitCode, string]> = [
    [program.exits.defect, "the program's defect code"],
    [program.exits.refused, "the program's refused code"],
    [0, "the code of a success with no verdict"],
  ];
  for (const command of program.commands) {
    const codes = Object.keys(command.verdicts ?? {})
      .map(Number)
      .toSorted((a, b) => a - b);
    for (const code of codes) {
      const meaning = meanings.find(([taken]) => taken === code);
      if (meaning !== undefined) {
        return line(
          `error: ${fullName(command).join(" ")} answers ${code} as a verdict, ${meaning[1]}`,
        );
      }
    }
  }
  return undefined;
}

/** The program's options (gain), by their names without dashes. */
const programOptionNames = (program: Program<unknown>): ReadonlyArray<string> =>
  program.options === undefined
    ? []
    : flagShapes(program.options.contract).map((flag) => flag.option);

/** The first option the runner owns that the program, or a command in program order, declares:
 *  `--json` and `--json-schema` on every command, `--out` on one that writes a document, and the
 *  program's options for every command (gain). A stdin flag counts. */
function reserved<R>(program: Program<R>): string | undefined {
  const options = programOptionNames(program);
  const own = options.find((option) => RESERVED.includes(option));
  if (own !== undefined) {
    return line(`error: the program declares --${own}, which the runner reserves`);
  }
  for (const command of program.commands) {
    const inputs: Inputs = command.input;
    const declared = [
      ...(inputs.flags === undefined
        ? []
        : flagShapes(inputs.flags.contract).map((flag) => flag.option)),
      ...(inputs.stdin?.flag === undefined ? [] : [inputs.stdin.flag]),
    ];
    const owned = command.writesDocument === true ? [...RESERVED, "out"] : RESERVED;
    const name = declared.find((option) => owned.includes(option));
    if (name !== undefined) {
      return line(
        `error: ${fullName(command).join(" ")} declares --${name}, which the runner reserves`,
      );
    }
    const shared = declared.find((option) => options.includes(option));
    if (shared !== undefined) {
      return line(
        `error: ${fullName(command).join(" ")} declares --${shared}, which the program declares for every command`,
      );
    }
  }
  return undefined;
}

/** Gain carried for upstream (a short alias): the first command, in program order, whose alias is
 *  not one letter, is `h` (the help's own), or is shared by two of its options. */
function aliasCollision<R>(program: Program<R>): string | undefined {
  for (const command of program.commands) {
    const inputs: Inputs = command.input;
    const flags = inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract);
    const seen = new Map<string, string>();
    for (const flag of flags) {
      const alias = flag.alias;
      if (alias === undefined) continue;
      const name = fullName(command).join(" ");
      if (!/^[A-Za-z]$/.test(alias) || alias === "h") {
        return line(
          `error: ${name} declares -${alias} for --${flag.option}, which is ${alias === "h" ? "the help's own" : "no one letter"}`,
        );
      }
      const other = seen.get(alias);
      if (other !== undefined) {
        return line(`error: ${name} declares -${alias} for both --${other} and --${flag.option}`);
      }
      seen.set(alias, flag.option);
    }
  }
  return undefined;
}

/** Gain carried for upstream (a group's retired words): the first group, in program order, that
 *  retires a word it also holds, a command or a group. */
function retiredCollision<R>(program: Program<R>): string | undefined {
  const walk = (
    entries: ReadonlyArray<Entry<R>>,
    path: ReadonlyArray<string>,
  ): string | undefined => {
    for (const entry of entries) {
      if (entry.kind !== "group") continue;
      const held = entry.entries.map(entryName);
      const words = Object.keys(entry.grouping.retired ?? {});
      const taken = words.find((word) => held.includes(word));
      const name = [...path, entry.name].join(" ");
      if (taken !== undefined) {
        return line(`error: ${name} retires ${taken}, a name it holds`);
      }
      const nested = walk(entry.entries, [...path, entry.name]);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return walk(treeOf(program), []);
}

/** Gain carried for upstream (a command's retired options): the first command, in program order,
 *  that retires an option it declares (a field's option or its stdin flag). */
function retiredOptionCollision<R>(program: Program<R>): string | undefined {
  for (const command of program.commands) {
    const retired = Object.keys(command.retiredOptions ?? {});
    if (retired.length === 0) continue;
    const inputs: Inputs = command.input;
    const declared = [
      ...(inputs.flags === undefined
        ? []
        : flagShapes(inputs.flags.contract).map((flag) => flag.option)),
      ...(inputs.stdin?.flag === undefined ? [] : [inputs.stdin.flag]),
    ];
    const taken = retired.find((option) => declared.includes(option));
    if (taken !== undefined) {
      return line(
        `error: ${fullName(command).join(" ")} retires --${taken}, an option it declares`,
      );
    }
  }
  return undefined;
}

/** Gain carried for upstream (a handed-over exit): the first command, in program order, that
 *  hands the terminal over and declares no `prompts`: under `--json` it would wait on a person. */
function handsOverUnprompted<R>(program: Program<R>): string | undefined {
  const command = program.commands.find(
    (each) => each.handsOver !== undefined && each.prompts === undefined,
  );
  return command === undefined
    ? undefined
    : line(`error: ${fullName(command).join(" ")} hands the terminal over and declares no prompts`);
}

/** A program the runner will not run: a command mapping a tag to the defect code, a verdict code
 *  that collides (gain), an option the runner owns, an alias that collides (gain), a retired
 *  word a group holds (gain), a retired option a command declares (gain), or a command handing
 *  the terminal over that declares no prompts (gain). */
const misdeclared = <R>(program: Program<R>): string | undefined =>
  collision(program) ??
  verdictCollision(program) ??
  reserved(program) ??
  aliasCollision(program) ??
  retiredCollision(program) ??
  retiredOptionCollision(program) ??
  handsOverUnprompted(program) ??
  versionAliasMisdeclared(program);

/** Gain carried for upstream (the version's short form): a version letter that is not one
 *  letter, or is `h`, the help's own. */
function versionAliasMisdeclared<R>(program: Program<R>): string | undefined {
  const alias = program.versionAlias;
  if (alias === undefined || (/^[A-Za-z]$/.test(alias) && alias !== "h")) return undefined;
  return line(
    `error: the program declares -${alias} for --version, which is ${alias === "h" ? "the help's own" : "no one letter"}`,
  );
}

/** The contracts, printed, and nothing else run or read. */
function printContracts<R>(
  program: Program<R>,
  io: Io,
  json: boolean,
  name: ReadonlyArray<string> | undefined,
): Effect.Effect<ExitCode> {
  return Effect.try(() =>
    encodedText(name === undefined ? catalogue(program) : commandContract(program, name)),
  ).pipe(
    Effect.flatMap((text) => io.out(text)),
    Effect.as(0),
    Effect.catchAllCause((cause) => defectOut(io, program, json, describe(cause))),
  );
}

/** Gain carried for upstream (the program's usage flag): a call of the usage flag, alone or with
 *  its format option (`kdl`, the one format), in either order. `undefined` when the call is not
 *  one; a refusal when it names the flag with anything else. */
function usageCall(usage: ProgramUsage, argv: Words): true | Refusal | undefined {
  const flag = `--${usage.flag}`;
  const format = usage.format === undefined ? undefined : `--${usage.format}`;
  const [head] = argv;
  const names = (word: string | undefined): boolean =>
    word !== undefined &&
    (word === flag || (format !== undefined && (word === format || word.startsWith(`${format}=`))));
  if (!names(head)) return undefined;
  let asked = false;
  let chosen: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] as string;
    if (word === flag && !asked) {
      asked = true;
    } else if (format !== undefined && word === format && chosen === undefined) {
      const next = argv[index + 1];
      if (next === undefined || isOption(next)) {
        return refusal(`error: option '${format} <format>' argument missing`, {
          source: "flags",
          path: [format],
          expected: "kdl",
        });
      }
      chosen = next;
      index += 1;
    } else if (format !== undefined && word.startsWith(`${format}=`) && chosen === undefined) {
      chosen = word.slice(format.length + 1);
    } else {
      return refusal(
        `error: ${flag} is answered alone${format === undefined ? "" : `, or with ${format} kdl`}`,
        {
          source: "command",
          path: [word],
          expected: `${flag} alone`,
        },
      );
    }
  }
  if (!asked) {
    return refusal(`error: ${format ?? flag} is given without ${flag}`, {
      source: "command",
      path: [format ?? flag],
      expected: flag,
    });
  }
  if (chosen !== undefined && chosen !== "kdl") {
    return refusal(`error: ${format} ${chosen}: the usage spec is written in kdl, its one format`, {
      source: "flags",
      path: [format ?? flag],
      expected: "kdl",
    });
  }
  return true;
}

/** Gain carried for upstream (a command that prompts): the refusal of a `--json` call whose
 *  decoded input would make the command ask a person; `undefined` when it would not. Asked after
 *  the decode and before `run`, so nothing has started. */
function promptRefusal<R>(ready: Ready<R>): Refusal | undefined {
  const prompts: ((input: never) => boolean) | undefined = ready.command.prompts;
  if (prompts === undefined || !prompts(ready.input as never)) return undefined;
  return refusal(
    `error: --json: ${fullName(ready.command).join(" ")} prompts; ${ready.command.unprompted ?? "run it without --json"}`,
    { source: "flags", path: ["json"], expected: "a call that does not prompt" },
  );
}

/** Gain carried for upstream (a document's check): the command's check, over its decoded input and
 *  its document as read, then its run. A `Refused` is the call refused, its fields the `refused`
 *  line's; any other failure or a death is a defect. Nothing runs after a refusal. */
function checkThenExecute<R>(
  program: Program<R>,
  io: Io,
  ready: Ready<R>,
  json: boolean,
): Effect.Effect<ExitCode, never, R> {
  const check:
    | ((context: {
        readonly input: never;
        readonly document: StdinDocument | undefined;
      }) => Effect.Effect<void, unknown, R>)
    | undefined = ready.command.check;
  if (check === undefined) return execute(program, io, ready, json);
  return Effect.suspend(() =>
    check({ input: ready.input as never, document: ready.document }),
  ).pipe(
    Effect.matchCauseEffect({
      onSuccess: () => execute(program, io, ready, json),
      onFailure: (cause) => {
        const failure = Option.getOrUndefined(Cause.failureOption(cause));
        if (failure instanceof Refused) {
          return refusedOut(
            io,
            program,
            json,
            refusal(failure.text, {
              source: failure.source,
              path: failure.path,
              expected: failure.expected,
            }),
          );
        }
        return defectOut(io, program, json, describe(cause));
      },
    }),
  );
}

const camelCase = (kebab: string): string =>
  kebab.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** Gain (the program's guard): the options a call gives before `--`, by their camelCase names:
 *  a long option by its name (`--dry-run=x` is `dryRun`), a short one by the name of the
 *  command's option it is the alias of, else by its letter. */
function givenOptions(words: Words, command: Command<unknown>): Readonly<Record<string, true>> {
  const inputs: Inputs = command.input;
  const shapes = inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract);
  const given: Record<string, true> = {};
  for (const word of words) {
    if (word === END_OF_OPTIONS) break;
    if (word.startsWith("--")) {
      const option = word.slice(2).split("=")[0] ?? "";
      const shape = shapes.find((each) => each.option === option);
      given[shape?.field ?? camelCase(option)] = true;
    } else if (isOption(word) && word.length > 1) {
      const letter = word.slice(1);
      const shape = shapes.find((each) => each.alias === letter);
      given[shape?.field ?? letter] = true;
    }
  }
  return given;
}

/** Gain (the program's guard): the located command, run through the program's guard, then
 *  `next`. A refusal is written and exited with; nothing after it runs. Help and the contracts
 *  run nothing, so the guard is never asked for them, nor for anything but a command. A guard
 *  that throws is a defect. */
function guarded<R>(
  program: Program<R>,
  io: Io,
  located: Located<R>,
  json: boolean,
  next: () => Effect.Effect<ExitCode, never, R>,
): Effect.Effect<ExitCode, never, R> {
  const guard = program.guard;
  if (guard === undefined || located.tag !== "Command") return next();
  const end = located.rest.indexOf(END_OF_OPTIONS);
  const options = end === -1 ? located.rest : located.rest.slice(0, end);
  if (options.some((word) => HELP.includes(word))) return next();
  return Effect.try(() =>
    guard({ words: located.path, options: givenOptions(io.argv, located.command) }),
  ).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => defectOut(io, program, json, describe(cause)),
      onSuccess: (refused) => {
        if (refused === undefined) return next();
        const text = json
          ? refusedLine(
              {
                source: "command",
                path: located.path,
                expected: refused.expected ?? "a command the program's guard allows",
              },
              refused.text,
              refused.exit,
            )
          : line(refused.text);
        return io.err(text).pipe(Effect.as(refused.exit));
      },
    }),
  );
}

/** Gain (the root's help command): `help [words]` read as `[words] --help`; any other call as
 *  it is. */
function asHelp(program: Program<unknown>, words: Words): Words {
  const [head, ...rest] = words;
  return head === HELP_WORD && hasHelpCommand(program) ? [...rest, HELP[0] ?? "--help"] : words;
}

function runProgram<R>(program: Program<R>, io: Io): Effect.Effect<ExitCode, never, R> {
  // Gain (options for every command): the program's options are taken out of the words first,
  // wherever they stand, so that what is left reads as a call without them.
  const read = takeProgramOptions(
    io.argv,
    program.options === undefined
      ? []
      : flagShapes(program.options.contract).map((flag) => ({
          field: flag.field,
          option: flag.option,
          takesValue: !flag.switch,
        })),
  );
  const given: ProgramWords = { ...read, kept: asHelp(program, read.kept) };
  const argv = given.kept;
  const [called, ...after] = argv;
  const named = called !== undefined && !isOption(called);
  const taken = named ? takeReserved(after) : { kept: after, json: false, schema: false };
  const json = taken.json;
  const stopped = misdeclared(program);
  if (stopped !== undefined) return defectOut(io, program, json, stopped);
  if (called === JSON_SCHEMA_OPTION && after.length === 0) {
    return printContracts(program, io, json, undefined);
  }
  if (program.usage === undefined) {
    if (called === USAGE_SPEC_OPTION && after.length === 0) {
      return io.out(usageSpec(program)).pipe(Effect.as(0));
    }
  } else {
    const usage = usageCall(program.usage, argv);
    if (usage instanceof Refusal) return refusedOut(io, program, json, usage);
    if (usage === true) return io.out(usageSpec(program)).pipe(Effect.as(0));
  }
  const located = locate(program, called === undefined ? [] : [called, ...taken.kept]);
  if (taken.schema && located.tag === "Command") {
    return printContracts(program, io, json, located.path);
  }
  // Gain (the program's guard): on the located command, before anything is decoded.
  return guarded(program, io, located, json, () =>
    prepareThenRun(program, io, located, given, json),
  );
}

/** The call read, decoded and run: refused, displayed (help, the version), or run. */
function prepareThenRun<R>(
  program: Program<R>,
  io: Io,
  located: Located<R>,
  given: ProgramWords,
  json: boolean,
): Effect.Effect<ExitCode, never, R> {
  return prepare(program, io, located, given).pipe(
    Effect.matchEffect({
      onFailure: (refused) => refusedOut(io, program, json, refused),
      onSuccess: (ready) => {
        if (ready.tag === "Displayed") return io.out(ready.text).pipe(Effect.as(0));
        // The order: decoded, then the `prompts` refusal under `--json`, then the check, then run.
        if (!json) return checkThenExecute(program, io, ready, json);
        return Effect.sync(() => promptRefusal(ready)).pipe(
          Effect.flatMap((refused) =>
            refused === undefined
              ? checkThenExecute(program, io, ready, json)
              : refusedOut(io, program, json, refused),
          ),
        );
      },
    }),
    Effect.catchAllCause((cause) => defectOut(io, program, json, describe(cause))),
  );
}

/** Commander's runner: reads a call, refuses it, or runs it. */
export const runner: Runner = { run: runProgram };
