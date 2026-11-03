import * as Schema from "effect/Schema";
import type {
  Command,
  CommandDef,
  Document,
  Group,
  Inputs,
  OutputRequired,
  Program,
  ProgramExits,
  Services,
  Source,
  Tagged,
  Undeclared,
} from "../contracts/command.ts";
import type { Written } from "./written.ts";

/** What a `stdin` source binds to a flag: its name without dashes, and whether the document is
 *  required (it is not, unless said so). */
export interface Binding<
  F extends string | undefined = string | undefined,
  Q extends boolean = boolean,
> {
  readonly flag?: F;
  readonly required?: Q;
}

function source<
  S extends Schema.Top,
  U extends Undeclared,
  F extends string | undefined,
  Q extends boolean,
>(
  contract: S,
  undeclared: U,
  binding: Binding<F, Q> | undefined,
): Source<S, U, F, Q> {
  const flag = binding?.flag;
  return flag === undefined
    ? { contract, undeclared }
    : {
        contract,
        undeclared,
        flag,
        required: (binding?.required ?? false) as Q,
      };
}

/** An argument, an option or a key the contract does not declare fails the decode. */
export function reject<
  S extends Schema.Top,
  const F extends string | undefined = undefined,
  const Q extends boolean = false,
>(contract: S, binding?: Binding<F, Q>): Source<S, "reject", F, Q> {
  return source(contract, "reject", binding);
}

/** What the contract does not declare is dropped. */
export function strip<
  S extends Schema.Top,
  const F extends string | undefined = undefined,
  const Q extends boolean = false,
>(contract: S, binding?: Binding<F, Q>): Source<S, "strip", F, Q> {
  return source(contract, "strip", binding);
}

export function defineCommand<
  const I extends Inputs,
  A,
  E extends Tagged = never,
  O extends Source<Schema.Top> | undefined = undefined,
  R = never,
>(definition: CommandDef<I, A, E, O, R> & OutputRequired<O, A>): Command<R> {
  return definition;
}

/** Commands under one word, `<program> <group> <command>`: the group's summary is what the
 *  program's help says of the word. A group holds commands, never another group. */
export function defineGroup<
  const C extends ReadonlyArray<Command<any>>,
>(group: {
  readonly name: string;
  readonly summary: string;
  readonly commands: C;
}): Group<Services<C[number]>> {
  return group;
}

const isGroup = (entry: Command<any> | Group<any>): entry is Group<any> =>
  "commands" in entry;

/** A program: its commands and groups, in the order declared. A group's commands are listed
 *  where the group stands, each carrying its group. */
export function defineProgram<
  const C extends ReadonlyArray<Command<any> | Group<any>>,
>(program: {
  readonly name: string;
  readonly version: string;
  readonly exits: ProgramExits;
  readonly commands: C;
}): Program<Services<C[number]>> {
  // A program of commands alone is answered as it is given.
  if (!program.commands.some(isGroup)) {
    return program as Program<Services<C[number]>>;
  }
  const commands = program.commands.flatMap(
    (entry): ReadonlyArray<Command<any>> =>
      isGroup(entry)
        ? entry.commands.map((command) => ({
            ...command,
            group: { name: entry.name, summary: entry.summary },
          }))
        : [entry],
  );
  return { ...program, commands };
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
  readonly $schema: Schema.String;
}> = Schema.Struct({ $schema: Schema.String }).annotate({
  description: "A document of the format its $schema names.",
});
