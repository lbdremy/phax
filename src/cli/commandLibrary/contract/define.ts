// The library's own `any`s, kept: commands and groups of any services are taken together, and
// their services inferred (`Services`), which no `unknown` admits under their variance.
/* oxlint-disable typescript/no-explicit-any */
import { Data } from "effect";
import * as Schema from "effect/Schema";
import type {
  Command,
  CommandDef,
  Document,
  Group,
  Grouping,
  Inputs,
  OutputRequired,
  Program,
  ProgramExits,
  ProgramUsage,
  Services,
  Source,
  StructContract,
  Tagged,
  Undeclared,
} from "./command.js";
import type { RefusalSource } from "./messages.js";
import type { Written } from "./written.js";

/** Gain carried for upstream (a document's check): why a command's `check` refuses the call —
 *  where the refusal was found (`source`), the path in it (`path`), what was expected there
 *  (`expected`), and the sentence a person reads (`text`, without its newline). The runner writes
 *  it as a `refused` line under `--json` and as its text without, and exits the `refused` code. */
export class Refused extends Data.TaggedError("Refused")<{
  readonly source: RefusalSource;
  readonly path: ReadonlyArray<string>;
  readonly expected: string;
  readonly text: string;
}> {}

/** What a `stdin` source binds to a flag: its name without dashes, and whether the document is
 *  required (it is not, unless said so). */
export interface Binding<
  F extends string | undefined = string | undefined,
  Q extends boolean = boolean,
> {
  readonly flag?: F;
  readonly required?: Q;
  /** Gain carried for upstream (a text stdin document): the document is text, handed to the
   *  contract as read. See `Source.text`. */
  readonly text?: true;
  /** Gain carried for upstream (a required stdin-flag value): the flag takes `<file|->`, spaced
   *  or attached. See `Source.valueRequired`. */
  readonly valueRequired?: true;
}

function source<
  S extends Schema.Schema.Any,
  U extends Undeclared,
  F extends string | undefined,
  Q extends boolean,
>(contract: S, undeclared: U, binding: Binding<F, Q> | undefined): Source<S, U, F, Q> {
  const flag = binding?.flag;
  const bound: Source<S, U, F, Q> =
    flag === undefined
      ? { contract, undeclared }
      : {
          contract,
          undeclared,
          flag,
          required: (binding?.required ?? false) as Q,
        };
  // The gains' keys are present only when declared, so a library source stays as it was.
  return {
    ...bound,
    ...(binding?.text === true ? { text: true as const } : {}),
    ...(flag !== undefined && binding?.valueRequired === true
      ? { valueRequired: true as const }
      : {}),
  };
}

/** An argument, an option or a key the contract does not declare fails the decode. */
export function reject<
  S extends Schema.Schema.Any,
  const F extends string | undefined = undefined,
  const Q extends boolean = false,
>(contract: S, binding?: Binding<F, Q>): Source<S, "reject", F, Q> {
  return source(contract, "reject", binding);
}

/** What the contract does not declare is dropped. */
export function strip<
  S extends Schema.Schema.Any,
  const F extends string | undefined = undefined,
  const Q extends boolean = false,
>(contract: S, binding?: Binding<F, Q>): Source<S, "strip", F, Q> {
  return source(contract, "strip", binding);
}

export function defineCommand<
  const I extends Inputs,
  A,
  E extends Tagged = never,
  O extends Source<Schema.Schema.Any> | undefined = undefined,
  R = never,
>(definition: CommandDef<I, A, E, O, R> & OutputRequired<O, A>): Command<R> {
  return definition;
}

/** Commands under one word, `<program> <group> <command>`: the group's summary is what the
 *  program's help says of the word.
 *
 *  Gain carried for upstream (groups holding groups): a group holds groups beside its commands,
 *  in the order declared.
 *
 *  Gain carried for upstream (a group's long help and examples): `help` and `examples`, shown in
 *  the group's help before its commands and written as its `long_help` and `example` nodes.
 *
 *  Gain carried for upstream (a group's retired words): `retired`, each word with the sentence
 *  that names its replacement, which the runner refuses the word with. */
export function defineGroup<const C extends ReadonlyArray<Command<any> | Group<any>>>(group: {
  readonly name: string;
  readonly summary: string;
  readonly help?: string;
  readonly examples?: ReadonlyArray<string>;
  readonly retired?: Readonly<Record<string, string>>;
  readonly commands: C;
}): Group<Services<C[number]>> {
  return group;
}

const isGroup = (entry: Command<any> | Group<any>): entry is Group<any> => "commands" in entry;

/** Each command of `entries`, in the order declared, a command of a group carrying its grouping:
 *  the group's name and summary, and the group it stands in when it is nested. */
function flatten(
  entries: ReadonlyArray<Command<any> | Group<any>>,
  parent: Grouping | undefined,
): ReadonlyArray<Command<any>> {
  return entries.flatMap((entry): ReadonlyArray<Command<any>> => {
    if (!isGroup(entry)) {
      return parent === undefined ? [entry] : [{ ...entry, group: parent }];
    }
    // The gains' keys are present only when declared, so a library grouping stays as it was.
    const grouping: Grouping = {
      name: entry.name,
      summary: entry.summary,
      ...(entry.help === undefined ? {} : { help: entry.help }),
      ...(entry.examples === undefined ? {} : { examples: entry.examples }),
      ...(entry.retired === undefined ? {} : { retired: entry.retired }),
      ...(parent === undefined ? {} : { parent }),
    };
    return flatten(entry.commands, grouping);
  });
}

/** A program: its commands and groups, in the order declared. A group's commands are listed
 *  where the group stands, each carrying its group; a nested group's, its chain of groups. */
export function defineProgram<const C extends ReadonlyArray<Command<any> | Group<any>>>(program: {
  readonly name: string;
  readonly version: string;
  readonly exits: ProgramExits;
  readonly commands: C;
  readonly usage?: ProgramUsage;
  readonly options?: Source<StructContract>;
  readonly refusalHint?: string;
}): Program<Services<C[number]>> {
  // A program of commands alone is answered as it is given.
  if (!program.commands.some(isGroup)) {
    return program as Program<Services<C[number]>>;
  }
  return { ...program, commands: flatten(program.commands, undefined) };
}

/** The document a command answers: its bytes, its format (its `$schema` URL, none unless said)
 *  and the files written beside it (none unless said). */
export function document(
  bytes: Uint8Array | string,
  options: {
    readonly format?: string | null;
    readonly written?: ReadonlyArray<Written>;
  } = {},
): Document {
  return {
    bytes,
    format: options.format ?? null,
    written: options.written ?? [],
  };
}

/** The output contract of a command that answers a document of a format that names itself: an
 *  object whose `$schema` is required. Spread `DocumentOutput.fields` into a `Schema.Struct` to
 *  say the rest. */
export const DocumentOutput: Schema.Struct<{
  readonly $schema: typeof Schema.String;
}> = Schema.Struct({ $schema: Schema.String }).annotations({
  description: "A document of the format its $schema names.",
});
