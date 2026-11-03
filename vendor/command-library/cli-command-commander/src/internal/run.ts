import { Cause, Data, Effect, Exit } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import {
  catalogue,
  commandContract,
  encodedText,
  fullName,
  messages,
  usageSpec,
  written,
  type Command,
  type ExitCode,
  type Inputs,
  type Io,
  type Program,
  type Runner,
  type Source,
} from "@steme-lab/cli-command";
import {
  parseCall,
  type CommandSpec,
  type ProgramSpec,
} from "../adapters/commander.ts";
import {
  defectLine,
  detailsOf,
  JSON_SCHEMA_OPTION,
  noteLines,
  OUT_OPTION,
  outcomeLine,
  refusedLine,
  RESERVED,
  takeOut,
  takeReserved,
  USAGE_SPEC_OPTION,
  type Details,
  type Out,
} from "./json.ts";
import { argShapes, flagShapes } from "./shape.ts";
import { readDocument, takeFlag, type Document } from "./stdin.ts";
import { defectText, outcomeOf } from "./outcome.ts";
import { HELP, isOption, readWords, VERSION } from "./undeclared.ts";

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
  readonly _tag: "Ready";
  readonly command: Command<R>;
  readonly input: Readonly<Record<string, unknown>>;
  /** `--out`, for a command that writes a document. */
  readonly out: Out;
}

/** Commander's help or version: the call ends here, with 0. */
interface Displayed {
  readonly _tag: "Displayed";
  readonly text: string;
}

const line = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;

const refusal = (text: string, details: Details): Refusal =>
  new Refusal({ text: line(text), ...details });

function specOf(command: Command<unknown>): CommandSpec {
  const inputs: Inputs = command.input;
  return {
    name: command.name,
    summary: command.summary,
    help: command.help,
    examples: command.examples,
    group: command.group,
    args: inputs.args === undefined ? [] : argShapes(inputs.args.contract),
    flags: inputs.flags === undefined ? [] : flagShapes(inputs.flags.contract),
    stdin: inputs.stdin !== undefined,
    stdinFlag: inputs.stdin?.flag,
    writesDocument: command.writesDocument === true,
    env:
      inputs.env === undefined
        ? undefined
        : Object.keys(inputs.env.contract.fields),
  };
}

function programSpecOf(program: Program<unknown>): ProgramSpec {
  return {
    name: program.name,
    version: program.version,
    commands: program.commands.map(specOf),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decodes one source's value with its policy applied literally. */
function decode(
  label: string,
  kind: Details["source"],
  source: Source<Schema.Top>,
  value: unknown,
  names: ReadonlyArray<string> = [],
): Effect.Effect<unknown, Refusal> {
  // A command line decodes synchronously: a source's contract needs no service to decode, which
  // `Schema.Top` cannot say (it leaves `DecodingServices` unknown).
  const contract =
    source.contract as unknown as Schema.ConstraintDecoder<unknown>;
  const exit = Schema.decodeUnknownExit(contract, {
    onExcessProperty: source.undeclared === "reject" ? "error" : "ignore",
  })(value);
  if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
  const excess =
    source.undeclared === "reject" ? excessKeys(source.contract, value) : [];
  const failure = Cause.squash(exit.cause);
  const why =
    excess.length > 0
      ? `undeclared ${excess.join(", ")}`
      : failure instanceof Error
        ? failure.message
        : String(failure);
  return Effect.fail(
    refusal(
      `error: ${label} does not decode: ${why}`,
      detailsOf(kind, failure, names),
    ),
  );
}

/** The keys of `value` that the contract does not declare, for `err` to name. */
function excessKeys(
  contract: Schema.Top,
  value: unknown,
): ReadonlyArray<string> {
  const ast = contract.ast;
  if (!SchemaAST.isObjects(ast) || !isRecord(value)) return [];
  const declared = ast.propertySignatures.map((property) =>
    String(property.name),
  );
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
    return {
      source: "flags",
      path: [unknownOption[1] ?? ""],
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

/** What the first words of a call name: nothing, an option, a command (alone or under a group),
 *  a group with no command under it, or a word that names none. `rest` is every word after the
 *  ones that named it. */
type Located<R> =
  | { readonly _tag: "Bare" }
  | { readonly _tag: "Option"; readonly name: string; readonly rest: Words }
  | {
      readonly _tag: "Command";
      readonly command: Command<R>;
      readonly path: ReadonlyArray<string>;
      readonly rest: Words;
    }
  | { readonly _tag: "Group"; readonly name: string; readonly rest: Words }
  | {
      readonly _tag: "Unknown";
      readonly word: string;
      readonly known: ReadonlyArray<string>;
    };

type Words = ReadonlyArray<string>;

/** The words a program is called by at its top: its commands and its groups, in order. */
function topLevel<R>(program: Program<R>): ReadonlyArray<string> {
  return [
    ...new Set(
      program.commands.map((command) => command.group?.name ?? command.name),
    ),
  ];
}

/** Reads the call's first words against the program: `<command>`, `<group> <command>`, a group
 *  alone, or a word that is none of them. */
function locate<R>(program: Program<R>, argv: Words): Located<R> {
  const [head, ...rest] = argv;
  if (head === undefined) return { _tag: "Bare" };
  if (isOption(head)) return { _tag: "Option", name: head, rest };
  const alone = program.commands.find(
    (command) => command.group === undefined && command.name === head,
  );
  if (alone !== undefined) {
    return { _tag: "Command", command: alone, path: [head], rest };
  }
  const members = program.commands.filter(
    (command) => command.group?.name === head,
  );
  if (members.length === 0) {
    return { _tag: "Unknown", word: head, known: topLevel(program) };
  }
  const [word, ...after] = rest;
  if (word === undefined || isOption(word)) {
    return { _tag: "Group", name: head, rest };
  }
  const command = members.find((member) => member.name === word);
  return command === undefined
    ? {
        _tag: "Unknown",
        word,
        known: members.map((member) => member.name),
      }
    : { _tag: "Command", command, path: [head, word], rest: after };
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
  if (located._tag === "Bare") return { words: [] };
  if (located._tag === "Option") {
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
  if (located._tag === "Unknown") {
    return refusal(`error: unknown command '${located.word}'`, {
      source: "command",
      path: [located.word],
      expected: `one of ${located.known.join(", ")}`,
    });
  }
  // A group alone is Commander's: its help on stderr, refused. Its own help is Commander's too.
  if (located._tag === "Group") return { words: [located.name, ...kept] };
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
    for (const option of read.undeclared) {
      problems.push({
        text: `error: unknown option '${option}'`,
        details: {
          source: "flags",
          path: [option],
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
  const given =
    inputs.args === undefined ? 0 : argShapes(inputs.args.contract).length;
  const surplus = read.operands.slice(given);
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
): Effect.Effect<Ready<R> | Displayed, Refusal> {
  return Effect.gen(function* () {
    const known = located._tag === "Command" ? located.command : undefined;
    const words =
      located._tag === "Command" || located._tag === "Group"
        ? located.rest
        : [];
    // The runner reads `--out`, and the flag a stdin read is bound to, itself, before Commander
    // sees the words.
    const writes = known?.writesDocument === true;
    const outTaken = writes
      ? takeOut(words)
      : { kept: words, out: { _tag: "Absent" } as Out };
    const flag = known?.input.stdin?.flag;
    const taken =
      flag === undefined
        ? { kept: outTaken.kept, reading: { _tag: "Absent" } as const }
        : takeFlag(outTaken.kept, flag);
    const checked = precheck(program, located, taken.kept);
    if (checked instanceof Refusal) return yield* checked;
    const out = outTaken.out;
    if (out._tag === "Missing") {
      return yield* refusal(`error: option '${out.word}' argument missing`, {
        source: "flags",
        path: [OUT_OPTION],
        expected: "a path, or - for the standard output",
      });
    }
    const parsed = parseCall(
      programSpecOf(program),
      checked.words,
      io.terminal,
    );
    if (parsed._tag === "Shown") {
      return { _tag: "Displayed", text: parsed.text } as const;
    }
    if (parsed._tag === "Refused") {
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

    const shapes =
      declared.args === undefined ? [] : argShapes(declared.args.contract);
    if (declared.args !== undefined) {
      input["args"] = yield* decode(
        "args",
        "args",
        declared.args,
        parsed.operands.slice(0, shapes.length),
        shapes.map((shape) => shape.name),
      );
    }
    if (declared.flags !== undefined) {
      input["flags"] = yield* decode(
        "flags",
        "flags",
        declared.flags,
        parsed.options,
      );
    }
    if (declared.stdin !== undefined) {
      const document = yield* readDocument(
        io,
        command.name,
        declared.stdin,
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
      input["stdin"] =
        document === undefined
          ? undefined
          : yield* decode(
              document.label,
              "stdin",
              declared.stdin,
              yield* parseJson(document),
            );
    }
    if (declared.env !== undefined) {
      const env = Object.fromEntries(
        Object.entries(io.env).filter(([, value]) => value !== undefined),
      );
      input["env"] = yield* decode("env", "env", declared.env, env);
    }
    return { _tag: "Ready", command, input, out } as const;
  });
}

function describe(cause: Cause.Cause<unknown>): string {
  return defectText(Cause.pretty(cause));
}

const policyOf = (output: Source<Schema.Top>) =>
  ({
    onExcessProperty: output.undeclared === "reject" ? "error" : "ignore",
  }) as const;

/** Encodes `run`'s value with the output contract and its policy: the output's encoded form. A
 *  failure is a defect. */
function encode(
  output: Source<Schema.Top>,
  value: unknown,
): Effect.Effect<unknown, Defect> {
  const encoded = Schema.encodeUnknownExit(
    output.contract as unknown as Schema.ConstraintEncoder<unknown>,
    policyOf(output),
  )(value);
  return Exit.isFailure(encoded)
    ? Effect.fail(new Defect({ text: describe(encoded.cause) }))
    : Effect.succeed(encoded.value);
}

/** Decodes an encoded output back: the reduced value `render`, `notes` and `document` receive.
 *  A failure is a defect. */
function reduced(
  output: Source<Schema.Top>,
  encoded: unknown,
): Effect.Effect<unknown, Defect> {
  const decoded = Schema.decodeUnknownExit(
    output.contract as unknown as Schema.ConstraintDecoder<unknown>,
    policyOf(output),
  )(encoded);
  return Exit.isFailure(decoded)
    ? Effect.fail(new Defect({ text: describe(decoded.cause) }))
    : Effect.succeed(decoded.value);
}

/** What the call writes: stdout, and stderr as it is written (text, or message lines). */
interface Presented {
  readonly out: string;
  readonly err: string;
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
    const output: Source<Schema.Top> | undefined = command.output;
    const render:
      | ((value: unknown, terminal: Io["terminal"]) => string)
      | undefined = command.render;
    const notes:
      | ((value: unknown, terminal: Io["terminal"]) => string)
      | undefined = command.notes;
    const documentOf = command.document;
    const encoded =
      output === undefined ? undefined : yield* encode(output, value);
    const needsView =
      documentOf !== undefined ||
      notes !== undefined ||
      (!json && render !== undefined);
    const view: unknown =
      output === undefined || !needsView
        ? value
        : yield* reduced(output, encoded);
    const document =
      documentOf === undefined
        ? undefined
        : yield* Effect.sync(() => documentOf(view));
    const toPath =
      command.writesDocument === true && out._tag === "Path"
        ? out.path
        : undefined;
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
            : yield* Effect.sync(() =>
                new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              );
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
    const said =
      notes === undefined
        ? ""
        : yield* Effect.sync(() => notes(view, io.terminal));
    const err = json
      ? (document?.written ?? []).map(messages.written).join("") +
        noteLines(said)
      : said === ""
        ? ""
        : line(said);
    return { out: stdout, err };
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
        : refused.text,
    )
    .pipe(Effect.as(program.exits.refused));

/** The value `run` succeeded with, composed and written. `out` is written last. */
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
      }),
    ),
    Effect.as(0),
    Effect.catchCause((cause) => {
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

function execute<R>(
  program: Program<R>,
  io: Io,
  ready: Ready<R>,
  json: boolean,
): Effect.Effect<ExitCode, never, R> {
  return Effect.suspend(() => ready.command.run({ input: ready.input })).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => {
        const outcome = outcomeOf(program, ready.command, cause);
        if (!json) return io.err(outcome.text).pipe(Effect.as(outcome.code));
        const answer = outcomeLine(outcome, program.exits.defect);
        return io.err(answer.line).pipe(Effect.as(answer.code));
      },
      onSuccess: (value: unknown) => present(program, io, ready, value, json),
    }),
    Effect.catchCause((cause) => defectOut(io, program, json, describe(cause))),
  );
}

/** The first command, in program order, that maps a tag to the program's defect code. */
function collision<R>(program: Program<R>): string | undefined {
  for (const command of program.commands) {
    const exits: Readonly<Record<string, ExitCode>> = command.exits;
    const tag = Object.keys(exits).find(
      (key) => exits[key] === program.exits.defect,
    );
    if (tag !== undefined) {
      return line(
        `error: ${fullName(command).join(" ")} maps ${tag} to ${program.exits.defect}, the program's defect code`,
      );
    }
  }
  return undefined;
}

/** The first command, in program order, that declares an option the runner owns: `--json` and
 *  `--json-schema` on every command, `--out` on one that writes a document. A stdin flag counts. */
function reserved<R>(program: Program<R>): string | undefined {
  for (const command of program.commands) {
    const inputs: Inputs = command.input;
    const declared = [
      ...(inputs.flags === undefined
        ? []
        : flagShapes(inputs.flags.contract).map((flag) => flag.option)),
      ...(inputs.stdin?.flag === undefined ? [] : [inputs.stdin.flag]),
    ];
    const owned =
      command.writesDocument === true ? [...RESERVED, "out"] : RESERVED;
    const name = declared.find((option) => owned.includes(option));
    if (name !== undefined) {
      return line(
        `error: ${fullName(command).join(" ")} declares --${name}, which the runner reserves`,
      );
    }
  }
  return undefined;
}

/** The contracts, printed, and nothing else run or read. */
function printContracts<R>(
  program: Program<R>,
  io: Io,
  json: boolean,
  name: ReadonlyArray<string> | undefined,
): Effect.Effect<ExitCode> {
  return Effect.try(() =>
    encodedText(
      name === undefined ? catalogue(program) : commandContract(program, name),
    ),
  ).pipe(
    Effect.flatMap((text) => io.out(text)),
    Effect.as(0),
    Effect.catchCause((cause) => defectOut(io, program, json, describe(cause))),
  );
}

function runProgram<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  const [called, ...after] = io.argv;
  const named = called !== undefined && !isOption(called);
  const taken = named
    ? takeReserved(after)
    : { kept: after, json: false, schema: false };
  const json = taken.json;
  const stopped = collision(program) ?? reserved(program);
  if (stopped !== undefined) return defectOut(io, program, json, stopped);
  if (called === JSON_SCHEMA_OPTION && after.length === 0) {
    return printContracts(program, io, json, undefined);
  }
  if (called === USAGE_SPEC_OPTION && after.length === 0) {
    return io.out(usageSpec(program)).pipe(Effect.as(0));
  }
  const located = locate(
    program,
    called === undefined ? [] : [called, ...taken.kept],
  );
  if (taken.schema && located._tag === "Command") {
    return printContracts(program, io, json, located.path);
  }
  return prepare(program, io, located).pipe(
    Effect.matchEffect({
      onFailure: (refused) => refusedOut(io, program, json, refused),
      onSuccess: (ready) =>
        ready._tag === "Displayed"
          ? io.out(ready.text).pipe(Effect.as(0))
          : execute(program, io, ready, json),
    }),
    Effect.catchCause((cause) => defectOut(io, program, json, describe(cause))),
  );
}

/** Commander's runner: reads a call, refuses it, or runs it. */
export const runner: Runner = { run: runProgram };
