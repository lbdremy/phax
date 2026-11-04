import { Cause, Data, Effect, Either } from "effect";
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
  usageSpec,
  written,
  type Command,
  type ExitCode,
  type Grouping,
  type Inputs,
  type Io,
  type Program,
  type ProgramUsage,
  type RunContext,
  type Runner,
  type Source,
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
        : { name: stdin.flag, valueRequired: stdin.valueRequired === true },
    writesDocument: command.writesDocument === true,
    env: inputs.env === undefined ? undefined : Object.keys(inputs.env.contract.fields),
  };
}

/** The root's own options, for its help: `--json-schema`, the usage flag (gain) and the
 *  program's options for every command (gain). The runner reads each before Commander does. */
function rootOptionsOf(program: Program<unknown>): ReadonlyArray<RootOption> {
  const options: RootOption[] = [
    {
      flags: JSON_SCHEMA_OPTION,
      help:
        program.usage?.jsonSchema === "program"
          ? OPTION_HELP.anyJsonSchema
          : OPTION_HELP.programJsonSchema,
    },
  ];
  const usage = program.usage;
  if (usage !== undefined) {
    options.push({ flags: `--${usage.flag}`, help: OPTION_HELP.usage });
    if (usage.format !== undefined) {
      options.push({ flags: `--${usage.format} <format>`, help: OPTION_HELP.usageFormat });
    }
  }
  if (program.options !== undefined) {
    for (const flag of flagShapes(program.options.contract)) {
      options.push({
        flags: flag.switch ? `--${flag.option}` : `--${flag.option} <${flag.field}>`,
        help: flag.help ?? "",
      });
    }
  }
  return options;
}

function programSpecOf(program: Program<unknown>): ProgramSpec {
  return {
    name: program.name,
    version: program.version,
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
  | { readonly kind: "group"; readonly name: string; readonly entries: Entry<R>[] };

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
        found = { kind: "group", name: group.name, entries: [] };
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
      return { tag: "Unknown", word: head, known: [...new Set(level.map(entryName))] };
    }
    path.push(head);
    level = group.entries;
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
    if (rest.length === 0 && (HELP.includes(name) || name === VERSION)) {
      return { words: [name] };
    }
    const alone = HELP.includes(name) || name === VERSION;
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
        })),
  );
  if (read.help) return { words: [...path, "--help"] };
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
    ].map((flag) => `--${flag.option}`);
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
    problems.push({
      text: `error: option '${read.valueMissing}' argument missing`,
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
      return yield* refusal(`error: option '${given.valueMissing}' argument missing`, {
        source: "flags",
        path: [given.valueMissing],
        expected: "a value",
      });
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
      (notes !== undefined || verdicts !== undefined || (!json && render !== undefined));
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
      stdout = `${yield* Effect.sync(() => render(view, io.terminal))}\n`;
    } else if (output !== undefined) {
      stdout = encodedText(encoded);
    }
    const said = notes === undefined ? "" : yield* Effect.sync(() => notes(view, io.terminal));
    const err = json
      ? (document?.written ?? []).map(messages.written).join("") + noteLines(said)
      : said === ""
        ? ""
        : line(said);
    const code = verdicts === undefined ? 0 : yield* Effect.sync(() => verdictOf(verdicts, view));
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
): (() => string) | undefined {
  const declared = declaredOf(command, cause);
  if (declared === undefined) return undefined;
  const texts: Readonly<Record<string, ((error: never) => string) | undefined>> | undefined =
    command.texts;
  const say = texts?.[declared.tag];
  return say === undefined ? undefined : () => say(declared.error as never);
}

function execute<R>(
  program: Program<R>,
  io: Io,
  ready: Ready<R>,
  json: boolean,
): Effect.Effect<ExitCode, never, R> {
  // Gain carried for upstream (progress notes): each note is written at once, while `run` runs.
  const context: RunContext<Inputs> = {
    input: ready.input,
    progress: (text) => {
      const note = json ? noteLines(text) : text === "" ? "" : line(text);
      return note === "" ? Effect.void : io.err(note);
    },
    program: ready.program,
  };
  return Effect.suspend(() => ready.command.run(context)).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => {
        const outcome = outcomeOf(program, ready.command, cause);
        if (!json) {
          const sentence = sentenceOf(ready.command, cause);
          if (sentence === undefined) return io.err(outcome.text).pipe(Effect.as(outcome.code));
          return Effect.sync(() => line(sentence())).pipe(
            Effect.flatMap((text) => io.err(text)),
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

/** A program the runner will not run: a command mapping a tag to the defect code, a verdict code
 *  that collides (gain), or an option the runner owns. */
const misdeclared = <R>(program: Program<R>): string | undefined =>
  collision(program) ?? verdictCollision(program) ?? reserved(program);

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
    `error: --json: ${fullName(ready.command).join(" ")} prompts; run it without --json`,
    { source: "flags", path: ["json"], expected: "a call that does not prompt" },
  );
}

function runProgram<R>(program: Program<R>, io: Io): Effect.Effect<ExitCode, never, R> {
  // Gain (options for every command): the program's options are taken out of the words first,
  // wherever they stand, so that what is left reads as a call without them.
  const given = takeProgramOptions(
    io.argv,
    program.options === undefined
      ? []
      : flagShapes(program.options.contract).map((flag) => ({
          field: flag.field,
          option: flag.option,
          takesValue: !flag.switch,
        })),
  );
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
  return prepare(program, io, located, given).pipe(
    Effect.matchEffect({
      onFailure: (refused) => refusedOut(io, program, json, refused),
      onSuccess: (ready) => {
        if (ready.tag === "Displayed") return io.out(ready.text).pipe(Effect.as(0));
        if (!json) return execute(program, io, ready, json);
        return Effect.sync(() => promptRefusal(ready)).pipe(
          Effect.flatMap((refused) =>
            refused === undefined
              ? execute(program, io, ready, json)
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
