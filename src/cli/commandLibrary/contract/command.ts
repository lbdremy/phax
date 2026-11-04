// The library's own `any`s, kept: a command read by a runner (`Command<R>`) holds any input,
// output, errors and answer, which no `unknown` admits under the definitions' variance.
/* oxlint-disable typescript/no-explicit-any */
import type { Effect } from "effect";
import type * as Schema from "effect/Schema";
import type { Written } from "./written.js";

/** What becomes of what a contract does not declare: `reject` fails the decode (the call is
 *  refused; for the output, a defect), `strip` drops it. Effect decides it at the decode, not in
 *  the schema, so a source declares it beside its contract, where a pack reads it. */
export type Undeclared = "reject" | "strip";

/** A contract with its policy: what the runner decodes a source with, or encodes the output with.
 *  A `stdin` source may also bind a flag (`flag`, the option's name without its dashes) and say
 *  whether the document is required (`required`): the runner then reads that flag itself, from
 *  the call's words, and reads the document from stdin or from the file attached to the flag. */
export interface Source<
  S extends Schema.Schema.Any,
  U extends Undeclared = Undeclared,
  F extends string | undefined = string | undefined,
  Q extends boolean = boolean,
> {
  readonly contract: S;
  readonly undeclared: U;
  readonly flag?: F;
  readonly required?: Q;
  /** Gain carried for upstream (a text stdin document): the `stdin` document is text, not JSON.
   *  The runner hands the contract the text as read, under the same reading and refusal rules as
   *  a JSON document; the contract decodes from a string (`Schema.String` and its refinements). */
  readonly text?: true;
  /** Gain carried for upstream (a required stdin-flag value): the bound flag takes a value,
   *  `--<flag> <file|->` spaced or `--<flag>=<file|->` attached; the flag alone is refused. The
   *  library's form, without it, takes an optional value attached only. */
  readonly valueRequired?: true;
}

/** A `Schema.Struct`, read by its shape: a schema with its fields. Effect 3's
 *  `Schema.Struct<Fields>` is invariant in its fields (through its `annotations` method), so the
 *  port names the struct a source holds by what the library reads of it. */
export type StructContract = Schema.Schema.Any & { readonly fields: Schema.Struct.Fields };

/** A `Schema.Tuple`, read by its shape: a schema with its elements (see `StructContract`). */
export type TupleContract = Schema.Schema.Any & { readonly elements: Schema.TupleType.Elements };

/** The sources a command reads, each a named Effect Schema with its policy, decoded before run. */
export interface Inputs {
  /** The positional arguments, typed by position. */
  readonly args?: Source<TupleContract>;
  /** The options, `--name value`. */
  readonly flags?: Source<StructContract>;
  /** What another tool writes to the standard input, as JSON (or as text, see `Source.text`). */
  readonly stdin?: Source<Schema.Schema.Any>;
  /** The variables of the environment the command reads. */
  readonly env?: Source<StructContract>;
}

/** What run receives: each declared source, decoded. A read bound to a flag and not required is
 *  `undefined` when the flag is absent. */
export type Parsed<I extends Inputs> = {
  readonly [K in keyof I]: NonNullable<I[K]> extends Source<infer S, any, infer F, infer Q>
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
type Shown<O, A> = O extends Source<infer S> ? S["Type"] : A;

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
  /** Gain carried for upstream (a group's long help): a longer help, shown after the group's
   *  summary in its help and written as its `long_help` in the usage spec. */
  readonly help?: string;
  /** Gain carried for upstream (a group's examples): command lines that show how the group's
   *  commands are called, one per entry: an `Examples:` block in the group's help, before its
   *  commands, and one `example` node each in the usage spec. */
  readonly examples?: ReadonlyArray<string>;
  /** Gain carried for upstream (groups holding groups): the group this group stands in, when it
   *  is nested. A command's grouping is so a chain, outermost last; its full name walks it. */
  readonly parent?: Grouping;
}

/** What `run` is handed beside its input. */
export interface RunContext<I extends Inputs> {
  readonly input: Parsed<I>;
  /** Gain carried for upstream (progress notes): a line for the person reading, written on
   *  stderr at once — a `note` line under `--json` — while `run` runs, never the output itself. */
  readonly progress: (text: string) => Effect.Effect<void>;
  /** Gain carried for upstream (options for every command): the program's options
   *  (`Program.options`), decoded from the call's words wherever they stand; `{}` when the
   *  program declares none. */
  readonly program: Readonly<Record<string, unknown>>;
}

export interface CommandDef<
  I extends Inputs,
  A,
  E extends Tagged,
  O extends Source<Schema.Schema.Any> | undefined,
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
  readonly errors?: { readonly [K in E["_tag"]]?: Schema.Schema.Any };
  /** Gain carried for upstream (a declared error's text form): the sentence a person reads for an
   *  error, by its tag, written on stderr without `--json` in place of the runner's own. Under
   *  `--json` the `error` line alone is written. The errors are inferred from `run`, in the
   *  order a definition's keys are written: write `texts` after a `run` that reads its context. */
  readonly texts?: {
    readonly [K in E["_tag"]]?: (error: Extract<E, { readonly _tag: K }>) => ErrorText;
  };
  /** Gain carried for upstream (verdict codes, from the Rust twin): codes a successful output
   *  answers with, each with the predicate that picks it, tried in ascending code order. The
   *  output is written in both modes and the call exits with the first code whose predicate
   *  holds, else 0. A code equal to 0 or to the program's `refused` or `defect` stops the
   *  program. */
  readonly verdicts?: { readonly [code: number]: (value: Shown<O, A>) => boolean };
  readonly run: (context: RunContext<I>) => Effect.Effect<Shown<O, A>, E, R>;
  /** A pure view: the reduced output in, text out. Without it, the runner prints the output's
   *  encoded form. */
  readonly render?: (value: Shown<O, A>, terminal: Terminal) => string;
  /** Lines for the standard error beside the output: a note for the person reading, never the
   *  output itself. Empty says nothing; under `--json` each line is a `note` line. */
  readonly notes?: (value: Shown<O, A>, terminal: Terminal) => string;
  /** Marks an answer that is a document: when it gives one, the runner writes its bytes and calls
   *  no `render`. A command answering documents writes this hook; the runner never recognises a
   *  document by itself. Port change: the hook is asked first, with the value `run` succeeded
   *  with, and a document is never encoded with the output contract; `notes` and the verdicts
   *  then read that value as it is. */
  readonly document?: (value: Shown<O, A>) => Document | undefined;
  /** The command writes a document, so the runner owns its `--out <path>`: the document is written
   *  to the path and the written-file record is the answer. `--out -`, or no `--out`, answers the
   *  document itself. A command declaring an option `out` beside this stops the program. */
  readonly writesDocument?: true;
  /** Gain carried for upstream (a command that prompts): whether the call, its input decoded,
   *  would ask a person something. When it holds and `--json` is given, the runner refuses the
   *  call after decoding and before `run`, with the program's `refused` code: `--json` never
   *  waits on a person. Without `--json` it is never asked. */
  readonly prompts?: (input: Parsed<I>) => boolean;
}

/** A command as a runner reads it; `R`, the services its run needs. */
export type Command<R = never> = CommandDef<any, any, any, any, R>;

/** Commands under one word: `<program> <group> <command>`. Each command keeps its own input,
 *  codes, `--json` and `--json-schema`; the group is only its parent in the help, the usage spec
 *  and the catalogue. A group called alone writes its help on stderr and is refused.
 *
 *  Gain carried for upstream (groups holding groups): a group holds groups beside its commands,
 *  `<program> <group> <group> <command>`, and a group called alone is refused at any depth. */
export interface Group<R = never> extends Grouping {
  readonly commands: ReadonlyArray<Command<R> | Group<R>>;
}

export type Services<C> =
  C extends Group<infer R> ? R : C extends CommandDef<any, any, any, any, infer R> ? R : never;

/** The runner's own exit codes, the program's to choose: a tool keeps the codes it documents. */
export interface ProgramExits {
  /** The call is refused: an unknown command, an undeclared argument or option, an input that does not decode. */
  readonly refused: ExitCode;
  /** A defect: what no command declared, a bug. */
  readonly defect: ExitCode;
}

/** Gain carried for upstream (the program's usage flag): the root flag the runner answers with
 *  the usage spec, in place of the library's hidden `--usage-spec`. */
export interface ProgramUsage {
  /** The flag's name without its dashes: `usage` is `--usage`. */
  readonly flag: string;
  /** The option that names the spec's format, without its dashes (`usage-format`); the runner
   *  writes KDL, its one format, and refuses any other. */
  readonly format?: string;
  /** Where the usage spec lists `--json-schema`: on every command (the library's way, the
   *  default), or once at the root as a global flag. */
  readonly jsonSchema?: "every-command" | "program";
}

export interface Program<R> {
  readonly name: string;
  readonly version: string;
  readonly exits: ProgramExits;
  /** Every command, in the order declared; a command of a group carries its `group`. */
  readonly commands: ReadonlyArray<Command<R>>;
  /** Gain carried for upstream: the program's usage flag. Without it, `--usage-spec`. */
  readonly usage?: ProgramUsage;
  /** Gain carried for upstream (options for every command): options the call may give wherever
   *  its words stand, decoded once and handed to every `run` as `program`; the usage spec writes
   *  them as global flags. */
  readonly options?: Source<StructContract>;
  /** Gain carried for upstream (a refusal's hint): a line written after a refusal's text without
   *  `--json`, as `Run \`phax --help\` for usage.`; never part of a `refused` line. */
  readonly refusalHint?: string;
}

/** The process, as data: what the edge hands a runner, so that a runner is proved without one. */
/** A declared error's text form: its sentence, written on stderr, or (gain carried for upstream,
 *  the text a command had reached) the lines a person read on stdout before the command failed,
 *  joined by newlines and written there with one more, then its sentence on stderr. */
export type ErrorText = string | { readonly out: string; readonly err: string };

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
  readonly writeFile: (path: string, bytes: Uint8Array) => Effect.Effect<void, string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly terminal: Terminal;
  readonly out: (text: string) => Effect.Effect<void>;
  readonly err: (text: string) => Effect.Effect<void>;
}

/** What a runner library offers: a program run against the process, to its exit code. The
 *  services the commands need are provided at the edge; nothing else exits. */
export interface Runner {
  readonly run: <R>(program: Program<R>, io: Io) => Effect.Effect<ExitCode, never, R>;
}
