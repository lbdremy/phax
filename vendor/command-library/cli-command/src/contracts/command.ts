import type { Effect } from "effect";
import type * as Schema from "effect/Schema";
import type { Written } from "../internal/written.ts";

/** What becomes of what a contract does not declare: `reject` fails the decode (the call is
 *  refused; for the output, a defect), `strip` drops it. Effect decides it at the decode, not in
 *  the schema, so a source declares it beside its contract, where a pack reads it. */
export type Undeclared = "reject" | "strip";

/** A contract with its policy: what the runner decodes a source with, or encodes the output with.
 *  A `stdin` source may also bind a flag (`flag`, the option's name without its dashes) and say
 *  whether the document is required (`required`): the runner then reads that flag itself, from
 *  the call's words, and reads the document from stdin or from the file attached to the flag. */
export interface Source<
  S extends Schema.Top,
  U extends Undeclared = Undeclared,
  F extends string | undefined = string | undefined,
  Q extends boolean = boolean,
> {
  readonly contract: S;
  readonly undeclared: U;
  readonly flag?: F;
  readonly required?: Q;
}

/** The sources a command reads, each a named Effect Schema with its policy, decoded before run. */
export interface Inputs {
  /** The positional arguments, typed by position. */
  readonly args?: Source<Schema.Tuple<Schema.Tuple.Elements>>;
  /** The options, `--name value`. */
  readonly flags?: Source<Schema.Struct<Schema.Struct.Fields>>;
  /** What another tool writes to the standard input, as JSON. */
  readonly stdin?: Source<Schema.Top>;
  /** The variables of the environment the command reads. */
  readonly env?: Source<Schema.Struct<Schema.Struct.Fields>>;
}

/** What run receives: each declared source, decoded. A read bound to a flag and not required is
 *  `undefined` when the flag is absent. */
export type Parsed<I extends Inputs> = {
  readonly [K in keyof I]: NonNullable<I[K]> extends Source<
    infer S,
    any,
    infer F,
    infer Q
  >
    ? [F] extends [string]
      ? [Q] extends [true]
        ? S["Type"]
        : S["Type"] | undefined
      : S["Type"]
    : never;
};

/** An error a command fails with: tagged, as `Data.TaggedError` makes it. */
export interface Tagged {
  readonly _tag: string;
}

/** The process's exit code. 0 is success; the program declares the runner's two — a call refused,
 *  a defect — and each command its own: a command may answer with the program's `refused`, never
 *  with its `defect` (the runner refuses a program where they collide, before it runs anything). */
export type ExitCode = number;

/** What the runner knows of the terminal it prints to, read once, handed to every renderer. */
export interface Terminal {
  readonly columns: number;
  readonly color: boolean;
}

/** What run succeeds with: the output contract's type when there is one. */
export type Shown<O, A> = O extends Source<infer S> ? S["Type"] : A;

/** What a command that answers a value must declare: when `run` succeeds with anything but
 *  nothing and there is no output contract, the definition is refused by the types. */
export type OutputRequired<O, A> = [O] extends [undefined]
  ? [A] extends [void | undefined]
    ? unknown
    : { readonly output: "a command that answers a value declares its output" }
  : unknown;

/** A document a command answers: bytes that are the document itself, not a view of it. The runner
 *  writes them on stdout as they are, in both modes, and calls no `render`; `--out` writes the same
 *  bytes to a file. */
export interface Document {
  /** The document's bytes; text is written as UTF-8. Nothing is added to them. */
  readonly bytes: Uint8Array | string;
  /** The document's format: its `$schema` URL, or none. */
  readonly format: string | null;
  /** The files the command wrote beside the document: under `--json`, one `written` line each. */
  readonly written: ReadonlyArray<Written>;
}

/** What a command says of the group it belongs to: `defineProgram` sets it on each command of a
 *  group; a command is never given one by hand. */
export interface Grouping {
  readonly name: string;
  readonly summary: string;
}

export interface CommandDef<
  I extends Inputs,
  A,
  E extends Tagged,
  O extends Source<Schema.Top> | undefined,
  R,
> {
  readonly name: string;
  readonly summary: string;
  /** A longer help, shown after the summary on `--help` and in the usage spec. */
  readonly help?: string;
  /** Command lines that show how it is called, one per entry: an `Examples:` block on `--help`
   *  and one `example` node each in the usage spec. */
  readonly examples?: ReadonlyArray<string>;
  /** The group the command belongs to, set by `defineProgram` from a `defineGroup`. */
  readonly group?: Grouping;
  readonly input: I;
  /** The output contract and its policy: the value is encoded against it before render. */
  readonly output?: O;
  /** An exit code for each error run may fail with, by its tag: the type asks for every one, and no other. */
  readonly exits: { readonly [K in E["_tag"]]: ExitCode };
  /** The fields of each error, as a schema, for the contracts catalogue. An error that declares
   *  none lists `{}`. The runner owns the field `written` (an array of written-file records): it
   *  is lifted out of the fields into the `error` line's `written`. */
  readonly errors?: { readonly [K in E["_tag"]]?: Schema.Top };
  readonly run: (context: {
    readonly input: Parsed<I>;
  }) => Effect.Effect<Shown<O, A>, E, R>;
  /** A pure view: the reduced output in, text out. Without it, the runner prints the output's
   *  encoded form. */
  readonly render?: (value: Shown<O, A>, terminal: Terminal) => string;
  /** Lines for the standard error beside the output: a note for the person reading, never the
   *  output itself. Empty says nothing; under `--json` each line is a `note` line. */
  readonly notes?: (value: Shown<O, A>, terminal: Terminal) => string;
  /** Marks an answer that is a document: when it gives one, the runner writes its bytes and calls
   *  no `render`. A command answering documents writes this hook; the runner never recognises a
   *  document by itself. */
  readonly document?: (value: Shown<O, A>) => Document | undefined;
  /** The command writes a document, so the runner owns its `--out <path>`: the document is written
   *  to the path and the written-file record is the answer. `--out -`, or no `--out`, answers the
   *  document itself. A command declaring an option `out` beside this stops the program. */
  readonly writesDocument?: true;
}

/** A command as a runner reads it; `R`, the services its run needs. */
export type Command<R = never> = CommandDef<any, any, any, any, R>;

/** Commands under one word: `<program> <group> <command>`. Each command keeps its own input,
 *  codes, `--json` and `--json-schema`; the group is only its parent in the help, the usage spec
 *  and the catalogue. A group called alone writes its help on stderr and is refused. */
export interface Group<R = never> extends Grouping {
  readonly commands: ReadonlyArray<Command<R>>;
}

export type Services<C> =
  C extends Group<infer R>
    ? R
    : C extends CommandDef<any, any, any, any, infer R>
      ? R
      : never;

/** The runner's own exit codes, the program's to choose: a tool keeps the codes it documents. */
export interface ProgramExits {
  /** The call is refused: an unknown command, an undeclared argument or option, an input that does not decode. */
  readonly refused: ExitCode;
  /** A defect: what no command declared, a bug. */
  readonly defect: ExitCode;
}

export interface Program<R> {
  readonly name: string;
  readonly version: string;
  readonly exits: ProgramExits;
  /** Every command, in the order declared; a command of a group carries its `group`. */
  readonly commands: ReadonlyArray<Command<R>>;
}

/** The process, as data: what the edge hands a runner, so that a runner is proved without one. */
export interface Io {
  /** The arguments after the executable and the script. */
  readonly argv: ReadonlyArray<string>;
  /** Read only when the command declares `stdin`, and never when `stdinIsTerminal`. */
  readonly stdin: Effect.Effect<string>;
  /** Stdin is a terminal: the runner refuses a call that would read it, instead of waiting. */
  readonly stdinIsTerminal: boolean;
  /** The bytes of a file, or why it could not be read. */
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, string>;
  /** Writes a file, or says why it could not. */
  readonly writeFile: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly terminal: Terminal;
  readonly out: (text: string) => Effect.Effect<void>;
  readonly err: (text: string) => Effect.Effect<void>;
}

/** What a runner library offers: a program run against the process, to its exit code. The
 *  services the commands need are provided at the edge; nothing else exits. */
export interface Runner {
  readonly run: <R>(
    program: Program<R>,
    io: Io,
  ) => Effect.Effect<ExitCode, never, R>;
}
