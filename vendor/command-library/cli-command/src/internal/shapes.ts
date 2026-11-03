import { Exit } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { Command } from "../contracts/command.ts";

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

/** A command's full name: its group's name when it has one, then its own. */
export function fullName(command: Command<unknown>): ReadonlyArray<string> {
  return command.group === undefined
    ? [command.name]
    : [command.group.name, command.name];
}

function isBooleanSide(ast: SchemaAST.AST): boolean {
  if (ast._tag === "Boolean") return true;
  if (ast._tag !== "Union") return false;
  const kinds = ast.types.map((member) => member._tag);
  return (
    kinds.includes("Boolean") &&
    kinds.every((kind) => kind === "Boolean" || kind === "Undefined")
  );
}

/** The key may be absent from the call: absent from the type, or, with a default, from the
 *  encoded side alone. */
const isOptionalSide = (ast: SchemaAST.AST): boolean =>
  SchemaAST.isOptional(ast) || SchemaAST.isOptional(SchemaAST.toEncoded(ast));

/** The description an element or field was annotated with, on the schema or on its encoded side. */
function helpOf(ast: SchemaAST.AST): string | undefined {
  return (
    SchemaAST.resolveDescription(ast) ??
    SchemaAST.resolveDescription(SchemaAST.toEncoded(ast))
  );
}

/** The literals of a literal, or of a union of literals (and `undefined`), as text. */
function choicesOf(ast: SchemaAST.AST): ReadonlyArray<string> | undefined {
  const members = ast._tag === "Union" ? ast.types : [ast];
  const literals: string[] = [];
  for (const member of members) {
    if (member._tag === "Undefined") continue;
    if (member._tag !== "Literal") return undefined;
    literals.push(String(member.literal));
  }
  return literals.length === 0 ? undefined : literals;
}

/** What a schema decodes to when its key is absent: the default it declares, as text. Effect does
 *  not expose a default as data, so the schema is decoded once, with nothing given. A value that
 *  is not a string, a number or a bigint is not shown. */
function defaultOf(
  wrap: (schema: Schema.Constraint) => unknown,
  empty: unknown,
  pick: (decoded: unknown) => unknown,
  schema: Schema.Constraint,
): string | undefined {
  let decoded: unknown;
  try {
    const exit = Schema.decodeUnknownExit(
      wrap(schema) as Schema.ConstraintDecoder<unknown>,
    )(empty);
    if (!Exit.isSuccess(exit)) return undefined;
    decoded = exit.value;
  } catch {
    // A default that needs a service or an asynchronous read is not a default to show.
    return undefined;
  }
  const value = pick(decoded);
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
    ? String(value)
    : undefined;
}

export function argShapes(
  contract: Schema.Tuple<Schema.Tuple.Elements>,
): ReadonlyArray<ArgShape> {
  const taken = new Set<string>();
  return contract.elements.map((element, index) => {
    const ast = element.ast;
    const named = SchemaAST.resolveIdentifier(ast);
    const name =
      named === undefined || taken.has(named) ? `arg${index}` : named;
    taken.add(name);
    const optional = isOptionalSide(ast);
    return {
      name,
      optional,
      help: helpOf(ast),
      choices: choicesOf(SchemaAST.toEncoded(ast)),
      default: optional
        ? defaultOf(
            (each) => Schema.Tuple([each]),
            [],
            (decoded) => (Array.isArray(decoded) ? decoded[0] : undefined),
            element,
          )
        : undefined,
    };
  });
}

export function flagShapes(
  contract: Schema.Struct<Schema.Struct.Fields>,
): ReadonlyArray<FlagShape> {
  return Object.entries(contract.fields).map(([field, schema]) => {
    const ast = schema.ast;
    const encoded = SchemaAST.toEncoded(ast);
    const isSwitch = isBooleanSide(encoded);
    return {
      field,
      option: kebabCase(field),
      optional: isOptionalSide(ast),
      switch: isSwitch,
      help: helpOf(ast),
      choices: isSwitch ? undefined : choicesOf(encoded),
      default: isSwitch
        ? undefined
        : defaultOf(
            (each) => Schema.Struct({ [field]: each }),
            {},
            (decoded) =>
              typeof decoded === "object" && decoded !== null
                ? Reflect.get(decoded, field)
                : undefined,
            schema,
          ),
    };
  });
}
