import { Result } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { Command, StructContract, TupleContract } from "./command.js";

/** Gain carried for upstream (completers): the key of the annotation an argument's element
 *  declares its completer under, beside its `identifier`:
 *  `Schema.String.annotate({ identifier: "short-name", [CompleterAnnotationId]: { run, descriptions } })`.
 *  The usage spec writes one `complete "<identifier>"` node per identifier. */
export const CompleterAnnotationId: unique symbol = Symbol.for("cli-command/annotation/Completer");

/** Gain carried for upstream (a short alias): the key of the annotation an option's field declares
 *  its one-letter alias under, on the field or on its type:
 *  `Schema.optionalKey(Schema.Boolean).annotateKey({ [AliasAnnotationId]: "y" })`.
 *  The option is then given as `-y` or `--yes` alike; help shows `-y, --yes`, the catalogue's
 *  property `x-alias: "-y"`, and the usage spec `flag "--yes -y"`. */
export const AliasAnnotationId: unique symbol = Symbol.for("cli-command/annotation/Alias");

/** Gain carried for upstream (an option with an optional value): the key of the annotation an
 *  option's field declares, on the field or on its type, when its value may be left out. The
 *  field's schema is a union of `true` and a string:
 *  `Schema.optionalKey(Schema.Union([Schema.Literal(true), Schema.String]))
 *  .annotateKey({ identifier: "selection", [OptionalValueAnnotationId]: true })`.
 *  The option then decodes to `true` when given bare (`--hold`) and to its value when given one
 *  (`--hold phase-02`, `--hold=phase-02`); help shows `--hold [selection]`, the catalogue the
 *  union, and the usage spec `flag "--hold [selection]"`. */
export const OptionalValueAnnotationId: unique symbol = Symbol.for(
  "cli-command/annotation/OptionalValue",
);

/** What an argument's completer says: the command line whose output lists the candidates, and
 *  whether each of its lines carries a description after a `:`. */
export interface Completer {
  readonly run: string;
  readonly descriptions: boolean;
}

/** A positional argument of a command, read from one element of its `args` contract. Its place is
 *  its index. */
export interface ArgShape {
  /** The element's `identifier` annotation, else `arg<index>`. */
  readonly name: string;
  readonly optional: boolean;
  /** The element's `description` annotation. */
  readonly help: string | undefined;
  /** The literals of a literal union, as the person types them. */
  readonly choices: ReadonlyArray<string> | undefined;
  /** What the element decodes to when the argument is absent, when it has a default. */
  readonly default: string | undefined;
  /** Gain carried for upstream: the completer the element's annotation declares, read only for
   *  an element named by its `identifier`. */
  readonly completer: Completer | undefined;
  /** Gain carried for upstream (variadic arguments): the tuple's rest element, which takes every
   *  operand left, always the last argument. It is optional (`[path...]`) unless the element just
   *  before it is required and of the rest's own schema, as `Schema.NonEmptyArray(x)` and
   *  `Schema.Tuple([x], x)` write it: that element is then folded into it, required
   *  (`<plan...>`). */
  readonly variadic: boolean;
}

/** An option of a command, read from one field of its `flags` contract. */
export interface FlagShape {
  /** The field's name in the contract, and so the key `run` receives. */
  readonly field: string;
  /** The long option's name without its dashes: `dryRun` is `dry-run`. */
  readonly option: string;
  /** Gain carried for upstream: the name of the option's value in its usage, `--plan <path>`:
   *  the field's `identifier` annotation, else the field's name. */
  readonly valueName: string;
  readonly optional: boolean;
  /** A Boolean on the encoded side is a switch, which takes no value. */
  readonly switch: boolean;
  readonly help: string | undefined;
  readonly choices: ReadonlyArray<string> | undefined;
  readonly default: string | undefined;
  /** Gain carried for upstream (a short alias): the letter its field's alias annotation declares,
   *  without its dash; `undefined` when it declares none. */
  readonly alias: string | undefined;
  /** Gain carried for upstream (an option with an optional value): the field's annotation says
   *  its value may be left out, `--hold [selection]`; never for a switch. */
  readonly valueOptional: boolean;
}

/** `dryRun` as `dry-run`: a hyphen before each uppercase letter, lowercased. */
export function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A command's full name: its groups' names, outermost first, when it has any, then its own. */
export function fullName(command: Command<unknown>): ReadonlyArray<string> {
  const names: string[] = [command.name];
  for (let group = command.group; group !== undefined; group = group.parent) {
    names.unshift(group.name);
  }
  return names;
}

/** The members of a union that are not `undefined`; the node itself when it is no union. */
const defined = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.AST> =>
  SchemaAST.isUnion(ast) ? ast.types.filter((member) => !SchemaAST.isUndefined(member)) : [ast];

function isBooleanSide(ast: SchemaAST.AST): boolean {
  const members = defined(ast);
  return members.length > 0 && members.every(SchemaAST.isBoolean);
}

/** The description written on a node (on its last check, where Effect's `annotate` puts it on
 *  a checked node). Effect 4 gives its keywords none, so every description is one someone wrote. */
const writtenOn = (ast: SchemaAST.AST): string | undefined => SchemaAST.resolveDescription(ast);

/** The description written on this node, or on the one member of its union with `undefined`. */
function helpOf(ast: SchemaAST.AST): string | undefined {
  const own = writtenOn(ast);
  if (own !== undefined) return own;
  const members = defined(ast);
  const only = members.length === 1 ? members[0] : undefined;
  return only === undefined || only === ast ? undefined : writtenOn(only);
}

/** The literals of a literal, or of a union of literals (and `undefined`), as text. */
function choicesOf(ast: SchemaAST.AST): ReadonlyArray<string> | undefined {
  const literals: string[] = [];
  for (const member of defined(ast)) {
    if (!SchemaAST.isLiteral(member)) return undefined;
    literals.push(String(member.literal));
  }
  return literals.length === 0 ? undefined : literals;
}

/** What a schema decodes to when its key is absent: the default it declares, as text. Effect does
 *  not expose a default as data, so the schema is decoded once, with nothing given. A value that
 *  is not a string, a number or a bigint is not shown. */
function defaultOf(
  schema: Schema.Top,
  empty: unknown,
  pick: (decoded: unknown) => unknown,
): string | undefined {
  let decoded: unknown;
  try {
    const result = Schema.decodeUnknownResult(Schema.make<Schema.Codec<unknown>>(schema.ast))(
      empty,
    );
    if (Result.isFailure(result)) return undefined;
    decoded = result.success;
  } catch {
    // A default that needs a service or an asynchronous read is not a default to show.
    return undefined;
  }
  const value = pick(decoded);
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : undefined;
}

/** The tuple node of a contract, or the side its first transformation decodes from. */
function tupleOf(ast: SchemaAST.AST): SchemaAST.Arrays | undefined {
  if (SchemaAST.isArrays(ast)) return ast;
  const from = ast.encoding?.[0].to;
  return from === undefined ? undefined : tupleOf(from);
}

/** The object node of a contract, or the side its first transformation decodes from, where a
 *  field with a default is still declared as written. */
function objectsOf(ast: SchemaAST.AST): SchemaAST.Objects | undefined {
  if (SchemaAST.isObjects(ast)) return ast;
  const from = ast.encoding?.[0].to;
  return from === undefined ? undefined : objectsOf(from);
}

/** A tuple element, a rest element or a struct field: its type, the annotations written on its
 *  place (its key's annotations), and whether it may be absent. */
interface Placed {
  readonly type: SchemaAST.AST;
  readonly annotations: Schema.Annotations.Annotations;
  readonly isOptional: boolean;
}

const placed = (type: SchemaAST.AST): Placed => ({
  type,
  annotations: type.context?.annotations ?? {},
  isOptional: type.context?.isOptional ?? false,
});

/** An annotation by its key: on the place, else on the type (or its last check). */
function declaredOn(element: Placed, key: symbol): unknown {
  return Reflect.get(element.annotations, key) ?? annotationOf(element.type, key);
}

/** An annotation by its key on a node, or on its last check where `annotate` puts it. */
function annotationOf(ast: SchemaAST.AST, key: symbol): unknown {
  const last = ast.checks?.at(-1);
  return (
    (last?.annotations === undefined ? undefined : Reflect.get(last.annotations, key)) ??
    (ast.annotations === undefined ? undefined : Reflect.get(ast.annotations, key))
  );
}

function completerOf(element: Placed): Completer | undefined {
  const declared = declaredOn(element, CompleterAnnotationId);
  if (typeof declared !== "object" || declared === null) return undefined;
  const run: unknown = Reflect.get(declared, "run");
  const descriptions: unknown = Reflect.get(declared, "descriptions");
  return typeof run === "string" ? { run, descriptions: descriptions === true } : undefined;
}

/** The `description` written on a place. */
const descriptionOf = (element: Placed): string | undefined => {
  const description = element.annotations["description"];
  return typeof description === "string" ? description : undefined;
};

/** The `identifier` written on a place, else on its type. */
const identifierOf = (element: Placed): string | undefined => {
  const identifier = element.annotations["identifier"];
  return typeof identifier === "string" ? identifier : SchemaAST.resolveIdentifier(element.type);
};

export function argShapes(contract: TupleContract): ReadonlyArray<ArgShape> {
  const tuple = tupleOf(contract.ast);
  const encodedTuple = tupleOf(SchemaAST.toEncoded(contract.ast));
  const elements = (tuple?.elements ?? []).map(placed);
  const encoded = (encodedTuple?.elements ?? []).map(placed);
  const restType = tuple?.rest[0];
  const rest = restType === undefined ? undefined : placed(restType);
  // Gain (variadic arguments): a required last element of the rest's own schema is folded into
  // the rest, which is then required.
  const last = elements.at(-1);
  const folded =
    rest !== undefined && last !== undefined && !last.isOptional && last.type === rest.type;
  const declared = folded ? elements.slice(0, -1) : elements;
  const taken = new Set<string>();
  const nameOf = (named: string | undefined, index: number): string => {
    const name = named === undefined || taken.has(named) ? `arg${index}` : named;
    taken.add(name);
    return name;
  };
  const shapes: ArgShape[] = declared.map((element, index) => {
    const named = identifierOf(element);
    const encodedType = encoded[index]?.type ?? element.type;
    const optional = encoded[index]?.isOptional ?? element.isOptional;
    return {
      name: nameOf(named, index),
      optional,
      help: descriptionOf(element) ?? helpOf(element.type),
      choices: choicesOf(encodedType),
      default: optional
        ? defaultOf(Schema.make(new SchemaAST.Arrays(false, [element.type], [])), [], (decoded) =>
            Array.isArray(decoded) ? decoded[0] : undefined,
          )
        : undefined,
      completer: named === undefined ? undefined : completerOf(element),
      variadic: false,
    };
  });
  if (rest === undefined) return shapes;
  const named = identifierOf(rest);
  shapes.push({
    name: nameOf(named, declared.length),
    optional: !folded,
    help: descriptionOf(rest) ?? helpOf(rest.type),
    choices: choicesOf(encodedTuple?.rest[0] ?? rest.type),
    default: undefined,
    completer: named === undefined ? undefined : completerOf(rest),
    variadic: true,
  });
  return shapes;
}

/** An annotation declared on a field: on its place, else on its type, else on the one member of
 *  its union with `undefined`. */
function fieldAnnotation(written: Placed, key: symbol): unknown {
  const members = defined(written.type);
  const only = members.length === 1 ? members[0] : undefined;
  return declaredOn(written, key) ?? (only === undefined ? undefined : annotationOf(only, key));
}

/** The alias declared on a field. */
function aliasOf(written: Placed | undefined): string | undefined {
  const declared = written === undefined ? undefined : fieldAnnotation(written, AliasAnnotationId);
  return typeof declared === "string" ? declared : undefined;
}

/** Whether a field declares its value optional. */
function valueOptionalOf(written: Placed | undefined): boolean {
  return written !== undefined && fieldAnnotation(written, OptionalValueAnnotationId) === true;
}

/** A struct node's field by name, as placed. */
function fieldOf(node: SchemaAST.Objects | undefined, field: string): Placed | undefined {
  const signature = node?.propertySignatures.find((candidate) => candidate.name === field);
  return signature === undefined ? undefined : placed(signature.type);
}

export function flagShapes(contract: StructContract): ReadonlyArray<FlagShape> {
  const declared = objectsOf(contract.ast);
  const encoded = objectsOf(SchemaAST.toEncoded(contract.ast));
  return Object.entries(contract.fields).map(([field, schema]) => {
    const written = fieldOf(declared, field);
    const side = fieldOf(encoded, field);
    const encodedType = side?.type ?? written?.type ?? SchemaAST.never;
    const isSwitch = isBooleanSide(encodedType);
    return {
      field,
      option: kebabCase(field),
      valueName: (written === undefined ? undefined : identifierOf(written)) ?? field,
      optional: side?.isOptional ?? written?.isOptional ?? false,
      switch: isSwitch,
      help: written === undefined ? undefined : (descriptionOf(written) ?? helpOf(written.type)),
      choices: isSwitch ? undefined : choicesOf(encodedType),
      default: isSwitch
        ? undefined
        : defaultOf(Schema.Struct({ [field]: schema }), {}, (decoded) =>
            typeof decoded === "object" && decoded !== null
              ? Reflect.get(decoded, field)
              : undefined,
          ),
      alias: aliasOf(written),
      valueOptional: !isSwitch && valueOptionalOf(written),
    };
  });
}

/** Gain carried for upstream (a stdin flag's help): the description written on the contract of a
 *  stdin read bound to a flag, which help and the usage spec give the flag in place of the
 *  library's own sentence; undefined when the contract carries none (Effect's own descriptions of
 *  its keywords are not one). */
export function stdinFlagHelp(contract: Schema.Top): string | undefined {
  return helpOf(contract.ast);
}
