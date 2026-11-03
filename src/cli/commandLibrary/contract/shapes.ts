import { Either, Option } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { Command, StructContract, TupleContract } from "./command.js";

/** Gain carried for upstream (completers): the key of the annotation an argument's element
 *  declares its completer under, beside its `identifier`:
 *  `Schema.String.annotations({ identifier: "short-name", [CompleterAnnotationId]: { run, descriptions } })`.
 *  The usage spec writes one `complete "<identifier>"` node per identifier. */
export const CompleterAnnotationId: unique symbol = Symbol.for("cli-command/annotation/Completer");

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
}

/** An option of a command, read from one field of its `flags` contract. */
export interface FlagShape {
  /** The field's name in the contract, and so the key `run` receives. */
  readonly field: string;
  /** The long option's name without its dashes: `dryRun` is `dry-run`. */
  readonly option: string;
  readonly optional: boolean;
  /** A Boolean on the encoded side is a switch, which takes no value. */
  readonly switch: boolean;
  readonly help: string | undefined;
  readonly choices: ReadonlyArray<string> | undefined;
  readonly default: string | undefined;
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
  SchemaAST.isUnion(ast)
    ? ast.types.filter((member) => !SchemaAST.isUndefinedKeyword(member))
    : [ast];

function isBooleanSide(ast: SchemaAST.AST): boolean {
  const members = defined(ast);
  return members.length > 0 && members.every(SchemaAST.isBooleanKeyword);
}

/** Effect 3's own keywords, each with the guard that recognises it: their descriptions
 *  (`Schema.String` is "a string") are not a help anyone wrote. */
const KEYWORDS: ReadonlyArray<readonly [(ast: SchemaAST.AST) => boolean, SchemaAST.AST]> = [
  [SchemaAST.isStringKeyword, SchemaAST.stringKeyword],
  [SchemaAST.isNumberKeyword, SchemaAST.numberKeyword],
  [SchemaAST.isBooleanKeyword, SchemaAST.booleanKeyword],
  [SchemaAST.isBigIntKeyword, SchemaAST.bigIntKeyword],
  [SchemaAST.isSymbolKeyword, SchemaAST.symbolKeyword],
  [SchemaAST.isObjectKeyword, SchemaAST.objectKeyword],
  [SchemaAST.isUndefinedKeyword, SchemaAST.undefinedKeyword],
  [SchemaAST.isVoidKeyword, SchemaAST.voidKeyword],
  [SchemaAST.isUnknownKeyword, SchemaAST.unknownKeyword],
  [SchemaAST.isAnyKeyword, SchemaAST.anyKeyword],
  [SchemaAST.isNeverKeyword, SchemaAST.neverKeyword],
];

const descriptionOf = (annotated: SchemaAST.Annotated): string | undefined =>
  Option.getOrUndefined(SchemaAST.getDescriptionAnnotation(annotated));

/** The description written on a node, not the one Effect gives its keyword. */
function writtenOn(ast: SchemaAST.AST): string | undefined {
  const description = descriptionOf(ast);
  const keyword = KEYWORDS.find(([is]) => is(ast))?.[1];
  return keyword !== undefined && descriptionOf(keyword) === description ? undefined : description;
}

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
  schema: Schema.Schema.Any,
  empty: unknown,
  pick: (decoded: unknown) => unknown,
): string | undefined {
  let decoded: unknown;
  try {
    const result = Schema.decodeUnknownEither(schema as Schema.Schema<unknown, unknown, never>)(
      empty,
    );
    if (Either.isLeft(result)) return undefined;
    decoded = result.right;
  } catch {
    // A default that needs a service or an asynchronous read is not a default to show.
    return undefined;
  }
  const value = pick(decoded);
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : undefined;
}

/** The tuple node under a contract's refinements and transformations: the side `from` holds. */
function tupleOf(ast: SchemaAST.AST): SchemaAST.TupleType | undefined {
  if (SchemaAST.isTupleType(ast)) return ast;
  if (SchemaAST.isRefinement(ast) || SchemaAST.isTransformation(ast)) return tupleOf(ast.from);
  return undefined;
}

/** The object node under a contract's refinements and transformations: the side `from` holds,
 *  where a field with a default is still declared as written. */
function literalOf(ast: SchemaAST.AST): SchemaAST.TypeLiteral | undefined {
  if (SchemaAST.isTypeLiteral(ast)) return ast;
  if (SchemaAST.isRefinement(ast) || SchemaAST.isTransformation(ast)) return literalOf(ast.from);
  return undefined;
}

function completerOf(element: SchemaAST.OptionalType): Completer | undefined {
  const declared: unknown =
    element.annotations[CompleterAnnotationId] ?? element.type.annotations[CompleterAnnotationId];
  if (typeof declared !== "object" || declared === null) return undefined;
  const run: unknown = Reflect.get(declared, "run");
  const descriptions: unknown = Reflect.get(declared, "descriptions");
  return typeof run === "string" ? { run, descriptions: descriptions === true } : undefined;
}

export function argShapes(contract: TupleContract): ReadonlyArray<ArgShape> {
  const declared = tupleOf(contract.ast)?.elements ?? [];
  const encoded = tupleOf(SchemaAST.encodedAST(contract.ast))?.elements ?? [];
  const taken = new Set<string>();
  return declared.map((element, index) => {
    const named = Option.getOrUndefined(
      Option.orElse(SchemaAST.getIdentifierAnnotation(element), () =>
        SchemaAST.getIdentifierAnnotation(element.type),
      ),
    );
    const name = named === undefined || taken.has(named) ? `arg${index}` : named;
    taken.add(name);
    const encodedType = encoded[index]?.type ?? element.type;
    const optional = encoded[index]?.isOptional ?? element.isOptional;
    return {
      name,
      optional,
      help: descriptionOf(element) ?? helpOf(element.type),
      choices: choicesOf(encodedType),
      default: optional
        ? defaultOf(Schema.make(new SchemaAST.TupleType([element], [], true)), [], (decoded) =>
            Array.isArray(decoded) ? decoded[0] : undefined,
          )
        : undefined,
      completer: named === undefined ? undefined : completerOf(element),
    };
  });
}

export function flagShapes(contract: StructContract): ReadonlyArray<FlagShape> {
  const declared = literalOf(contract.ast)?.propertySignatures ?? [];
  const encoded = literalOf(SchemaAST.encodedAST(contract.ast))?.propertySignatures ?? [];
  return Object.entries(contract.fields).map(([field, schema]) => {
    const written = declared.find((signature) => signature.name === field);
    const side = encoded.find((signature) => signature.name === field);
    const encodedType = side?.type ?? written?.type ?? SchemaAST.neverKeyword;
    const isSwitch = isBooleanSide(encodedType);
    return {
      field,
      option: kebabCase(field),
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
    };
  });
}
