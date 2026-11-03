import { Option } from "effect";
import * as JSONSchema from "effect/JSONSchema";
import type * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { Command, ExitCode, Inputs, Program, Source } from "./command.js";
import { DIALECT, messageSchemas, type JsonSchema } from "./messages.js";
import { argShapes, fullName, kebabCase } from "./shapes.js";

/** What a command's stdin read is, for an agent: the flag that binds it (as written), whether the
 *  document is required, and its schema. */
export interface StdinContract {
  /** As written: `--request`, or `--verdicts <file|->` for a flag whose value is required. */
  readonly flag: string | null;
  readonly required: boolean;
  readonly schema: JsonSchema;
  /** Gain carried for upstream: present, and true, when the document is text, not JSON. */
  readonly text?: true;
}

/** One declared error: its tag, its code, and its fields as a schema (`{}` when none is declared). */
export interface ErrorContract {
  readonly tag: string;
  readonly exit: ExitCode;
  readonly fields: JsonSchema;
}

/** Everything a caller needs to call one command and read its answer. */
export interface CommandContract {
  /** The command's full name: its words. */
  readonly name: ReadonlyArray<string>;
  /** The positionals (by name: their `identifier` annotation, else `arg0`, `arg1`, …) and the options (as written, without their dashes). */
  readonly input: JsonSchema;
  readonly stdin: StdinContract | null;
  /** The encoded form of the answer, or `null` for a command that answers nothing. */
  readonly output: JsonSchema | null;
  readonly errors: ReadonlyArray<ErrorContract>;
  /** Gain carried for upstream (verdict codes): the codes a successful output may answer with,
   *  ascending; present only when the command declares some. */
  readonly verdicts?: ReadonlyArray<ExitCode>;
}

/** What `<program> --json-schema` prints. */
export interface Catalogue {
  readonly program: string;
  readonly version: string;
  readonly exits: { readonly refused: ExitCode; readonly defect: ExitCode };
  readonly commands: ReadonlyArray<CommandContract>;
  /** The shapes of the message lines `--json` writes on stderr, by kind. */
  readonly messages: Readonly<Record<string, JsonSchema>>;
}

type Dictionary = Readonly<Record<string, unknown>>;

const isDictionary = (value: unknown): value is Dictionary =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const dictionaryOf = (value: unknown): Dictionary => (isDictionary(value) ? value : {});

/** The annotations an object, a tuple or a union keeps on its encoded side: its name and what
 *  its author wrote of it. */
const NAMING: ReadonlyArray<symbol> = [
  SchemaAST.IdentifierAnnotationId,
  SchemaAST.TitleAnnotationId,
  SchemaAST.DescriptionAnnotationId,
];

function naming(annotations: SchemaAST.Annotations): SchemaAST.Annotations {
  const kept: Record<symbol, unknown> = {};
  for (const key of NAMING) if (key in annotations) kept[key] = annotations[key];
  return kept;
}

const isComposite = (ast: SchemaAST.AST): boolean =>
  SchemaAST.isTypeLiteral(ast) || SchemaAST.isTupleType(ast) || SchemaAST.isUnion(ast);

const named = (ast: SchemaAST.AST): boolean =>
  Option.isSome(SchemaAST.getIdentifierAnnotation(ast));

/** A contract's encoded side, its objects, tuples and unions keeping their names. Effect 3's
 *  `SchemaAST.encodedAST` drops a node's annotations once one of its members encodes to another
 *  type (a `NumberFromString` field), so a named contract would lose its `$defs` entry; Effect 4's
 *  encoded side keeps it. A transformation's name moves to its encoded side only when that side
 *  is an object, a tuple or a union, so that `NumberFromString` stays a plain string. */
function encodedNamed(ast: SchemaAST.AST): SchemaAST.AST {
  if (SchemaAST.isTransformation(ast)) {
    const from = encodedNamed(ast.from);
    return isComposite(from) && named(ast) && !named(from)
      ? SchemaAST.annotations(from, naming(ast.annotations))
      : from;
  }
  if (SchemaAST.isRefinement(ast)) return encodedNamed(ast.from);
  if (SchemaAST.isTypeLiteral(ast)) {
    return new SchemaAST.TypeLiteral(
      ast.propertySignatures.map(
        (property) =>
          new SchemaAST.PropertySignature(
            property.name,
            encodedNamed(property.type),
            property.isOptional,
            property.isReadonly,
            property.annotations,
          ),
      ),
      ast.indexSignatures.map(
        (signature) =>
          new SchemaAST.IndexSignature(
            SchemaAST.encodedAST(signature.parameter),
            encodedNamed(signature.type),
            signature.isReadonly,
          ),
      ),
      naming(ast.annotations),
    );
  }
  if (SchemaAST.isTupleType(ast)) {
    return new SchemaAST.TupleType(
      ast.elements.map(
        (element) =>
          new SchemaAST.OptionalType(
            encodedNamed(element.type),
            element.isOptional,
            element.annotations,
          ),
      ),
      ast.rest.map((rest) => new SchemaAST.Type(encodedNamed(rest.type), rest.annotations)),
      ast.isReadonly,
      naming(ast.annotations),
    );
  }
  if (SchemaAST.isUnion(ast)) {
    return SchemaAST.Union.make(ast.types.map(encodedNamed), naming(ast.annotations));
  }
  return SchemaAST.encodedAST(ast);
}

/** Effect's JSON Schema 2020-12 of a contract's encoded side, with the shared definitions beside
 *  it: `schema` is the root, `definitions` what its `$ref`s name. A `reject` contract closes its
 *  objects (`additionalProperties: false`), a `strip` one leaves them open. */
function generated(
  contract: Schema.Schema.Any,
  undeclared: "reject" | "strip",
): { readonly schema: Dictionary; readonly definitions: Dictionary } {
  const definitions: Record<string, JSONSchema.JsonSchema7> = {};
  const schema = JSONSchema.fromAST(encodedNamed(contract.ast), {
    definitions,
    target: "jsonSchema2020-12",
    additionalPropertiesStrategy: undeclared === "reject" ? "strict" : "allow",
  });
  return { schema: dictionaryOf(schema), definitions };
}

/** The schema as a document of its own: the dialect first, its definitions last. */
function standalone(schema: Dictionary, definitions: Dictionary): JsonSchema {
  return {
    $schema: DIALECT,
    ...schema,
    ...(Object.keys(definitions).length === 0 ? {} : { $defs: definitions }),
  };
}

/** A contract's JSON Schema 2020-12, standalone. */
function schemaOf(contract: Schema.Schema.Any, undeclared: "reject" | "strip"): JsonSchema {
  const { schema, definitions } = generated(contract, undeclared);
  return standalone(schema, definitions);
}

/** The object a root `$ref` stands for, when the contract is named. */
function resolved(schema: Dictionary, definitions: Dictionary): Dictionary {
  const reference = schema["$ref"];
  if (typeof reference !== "string") return schema;
  const name = reference.replace(/^#\/\$defs\//, "");
  return dictionaryOf(definitions[name]);
}

/** The command's input: each positional as `arg<index>` and each option under its name as the
 *  call writes it, each with the schema of its encoded side. */
function inputOf(inputs: Inputs): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const definitions: Record<string, unknown> = {};
  if (inputs.args !== undefined) {
    const { schema, definitions: defs } = generated(inputs.args.contract, inputs.args.undeclared);
    Object.assign(definitions, defs);
    const items = resolved(schema, defs)["prefixItems"];
    const minimum = resolved(schema, defs)["minItems"];
    const names = argShapes(inputs.args.contract).map((arg) => arg.name);
    if (Array.isArray(items)) {
      items.forEach((item: unknown, index: number) => {
        const name = names[index] ?? `arg${index}`;
        properties[name] = item;
        if (typeof minimum === "number" && index < minimum) {
          required.push(name);
        }
      });
    }
  }
  if (inputs.flags !== undefined) {
    const { schema, definitions: defs } = generated(inputs.flags.contract, inputs.flags.undeclared);
    Object.assign(definitions, defs);
    const root = resolved(schema, defs);
    const fields = dictionaryOf(root["properties"]);
    const needed: ReadonlyArray<unknown> = Array.isArray(root["required"]) ? root["required"] : [];
    for (const [field, fieldSchema] of Object.entries(fields)) {
      properties[kebabCase(field)] = fieldSchema;
      if (needed.includes(field)) required.push(kebabCase(field));
    }
  }
  return standalone(
    {
      type: "object",
      properties,
      required,
      additionalProperties: inputs.flags?.undeclared === "strip",
    },
    definitions,
  );
}

/** A stdin flag as written: `--request`, or `--verdicts <file|->` when its value is required. */
export function stdinFlagUsage(source: Source<Schema.Schema.Any>): string | null {
  if (source.flag === undefined) return null;
  return source.valueRequired === true ? `--${source.flag} <file|->` : `--${source.flag}`;
}

function stdinOf(source: Source<Schema.Schema.Any> | undefined): StdinContract | null {
  if (source === undefined) return null;
  return {
    flag: stdinFlagUsage(source),
    required: source.flag === undefined ? true : source.required === true,
    schema: schemaOf(source.contract, source.undeclared),
    ...(source.text === true ? { text: true as const } : {}),
  };
}

/** One command's contracts. */
function commandEntry(command: Command<unknown>): CommandContract {
  const inputs: Inputs = command.input;
  const output: Source<Schema.Schema.Any> | undefined = command.output;
  const exits: Readonly<Record<string, ExitCode>> = command.exits;
  const declared: Readonly<Record<string, Schema.Schema.Any | undefined>> = command.errors ?? {};
  const verdicts = Object.keys(command.verdicts ?? {})
    .map(Number)
    .toSorted((a, b) => a - b);
  return {
    name: fullName(command),
    input: inputOf(inputs),
    stdin: stdinOf(inputs.stdin),
    output: output === undefined ? null : schemaOf(output.contract, output.undeclared),
    errors: Object.entries(exits).map(([tag, exit]) => {
      const fields = declared[tag];
      return {
        tag,
        exit,
        fields: fields === undefined ? {} : withoutWritten(schemaOf(fields, "strip")),
      };
    }),
    ...(verdicts.length === 0 ? {} : { verdicts }),
  };
}

/** An error's fields as its `error` line holds them: `written`, which the line lifts out of
 *  `fields` to its own key, is left out of the properties and of what they require. */
function withoutWritten(schema: JsonSchema): JsonSchema {
  const properties = dictionaryOf(schema["properties"]);
  if (!("written" in properties)) return schema;
  const { written: _written, ...kept } = properties;
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter((name) => name !== "written")
    : undefined;
  return {
    ...schema,
    properties: kept,
    ...(required === undefined ? {} : { required }),
  };
}

/** The contracts of every command of the program, and the shapes of the message lines. */
export function catalogue(program: Program<unknown>): Catalogue {
  return {
    program: program.name,
    version: program.version,
    exits: {
      refused: program.exits.refused,
      defect: program.exits.defect,
    },
    commands: program.commands.map(commandEntry),
    messages: messageSchemas,
  };
}

/** One command's entry, equal to its entry in the program's catalogue; `undefined` when the
 *  program has no such command. A command of a group is named by its full name. */
export function commandContract(
  program: Program<unknown>,
  name: string | ReadonlyArray<string>,
): CommandContract | undefined {
  const words = typeof name === "string" ? [name] : name;
  const command = program.commands.find(
    (candidate) => fullName(candidate).join(" ") === words.join(" "),
  );
  return command === undefined ? undefined : commandEntry(command);
}
