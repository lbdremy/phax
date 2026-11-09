import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { Command, ExitCode, Inputs, Program, Source } from "./command.js";
import { DIALECT, messageSchemas, type JsonSchema } from "./messages.js";
import { argShapes, flagShapes, fullName, kebabCase } from "./shapes.js";

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
  /** Gain carried for upstream (a handed-over exit): the command exits, without `--json`, with
   *  the code of the process it handed the terminal to; present only when it declares so. */
  readonly handsOver?: true;
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

/** Effect's JSON Schema 2020-12 of a contract's encoded side, with the shared definitions beside
 *  it: `schema` is the root, `definitions` what its `$ref`s name. A `reject` contract closes its
 *  objects (`additionalProperties: false`), a `strip` one leaves them open. Effect 4 keeps an
 *  object's, a tuple's and a union's names on the encoded side, so a named contract keeps its
 *  `$defs` entry, and a transformation's field (`NumberFromString`) is its encoded type. */
function generated(
  contract: Schema.Top,
  undeclared: "reject" | "strip",
): { readonly schema: Dictionary; readonly definitions: Dictionary } {
  const document = Schema.toJsonSchemaDocument(contract, {
    onExcessProperty: undeclared === "reject" ? "error" : "ignore",
  });
  return { schema: dictionaryOf(document.schema), definitions: document.definitions };
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
function schemaOf(contract: Schema.Top, undeclared: "reject" | "strip"): JsonSchema {
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
    const root = resolved(schema, defs);
    const prefix = root["prefixItems"];
    const items: ReadonlyArray<unknown> = Array.isArray(prefix) ? prefix : [];
    const minimum = typeof root["minItems"] === "number" ? root["minItems"] : 0;
    argShapes(inputs.args.contract).forEach((shape, index) => {
      // Gain (variadic arguments): the rest is one property, an array of its operands, which a
      // required variadic argument holds at least one of.
      if (shape.variadic) {
        const each = root["items"];
        properties[shape.name] = {
          type: "array",
          ...(each === undefined ? {} : { items: each }),
          ...(shape.optional ? {} : { minItems: 1 }),
        };
        if (!shape.optional) required.push(shape.name);
        return;
      }
      const item = items[index];
      if (item === undefined) return;
      properties[shape.name] = item;
      if (index < minimum) required.push(shape.name);
    });
  }
  if (inputs.flags !== undefined) {
    const { schema, definitions: defs } = generated(inputs.flags.contract, inputs.flags.undeclared);
    Object.assign(definitions, defs);
    const root = resolved(schema, defs);
    const fields = dictionaryOf(root["properties"]);
    const needed: ReadonlyArray<unknown> = Array.isArray(root["required"]) ? root["required"] : [];
    const aliases = new Map(
      flagShapes(inputs.flags.contract).map((shape) => [shape.field, shape.alias] as const),
    );
    for (const [field, fieldSchema] of Object.entries(fields)) {
      // Gain (a short alias): the option's entry says its letter as the call writes it.
      const alias = aliases.get(field);
      properties[kebabCase(field)] =
        alias === undefined
          ? fieldSchema
          : { ...dictionaryOf(fieldSchema), "x-alias": `-${alias}` };
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
export function stdinFlagUsage(source: Source<Schema.Top>): string | null {
  if (source.flag === undefined) return null;
  return source.valueRequired === true ? `--${source.flag} <file|->` : `--${source.flag}`;
}

function stdinOf(source: Source<Schema.Top> | undefined): StdinContract | null {
  if (source === undefined) return null;
  return {
    flag: stdinFlagUsage(source),
    required: source.flag === undefined ? true : source.required === true,
    schema: schemaOf(source.contract, source.undeclared),
    ...(source.text === true ? { text: true as const } : {}),
  };
}

/** Port change for phax's published formats: an output contract whose `jsonSchema` annotation
 *  is a reference alone to an absolute URL (`{ $ref: "https://…/run-list/0.34.0.json" }`) is
 *  that reference in the catalogue, the format's published schema standing for the generated
 *  one. */
function publishedReference(contract: Schema.Top): JsonSchema | undefined {
  const annotation = SchemaAST.resolveAt<unknown>("jsonSchema")(contract.ast);
  if (!isDictionary(annotation)) return undefined;
  const reference = annotation["$ref"];
  return Object.keys(annotation).length === 1 &&
    typeof reference === "string" &&
    !reference.startsWith("#")
    ? { $ref: reference }
    : undefined;
}

function outputOf(output: Source<Schema.Top> | undefined): JsonSchema | null {
  if (output === undefined) return null;
  return publishedReference(output.contract) ?? schemaOf(output.contract, output.undeclared);
}

/** One command's contracts. */
function commandEntry(command: Command<unknown>): CommandContract {
  const inputs: Inputs = command.input;
  const output: Source<Schema.Top> | undefined = command.output;
  const exits: Readonly<Record<string, ExitCode>> = command.exits;
  const declared: Readonly<Record<string, Schema.Top | undefined>> = command.errors ?? {};
  const verdicts = Object.keys(command.verdicts ?? {})
    .map(Number)
    .toSorted((a, b) => a - b);
  return {
    name: fullName(command),
    input: inputOf(inputs),
    stdin: stdinOf(inputs.stdin),
    output: outputOf(output),
    errors: Object.entries(exits).map(([tag, exit]) => {
      const fields = declared[tag];
      return {
        tag,
        exit,
        fields: fields === undefined ? {} : withoutWritten(schemaOf(fields, "strip")),
      };
    }),
    ...(verdicts.length === 0 ? {} : { verdicts }),
    ...(command.handsOver === undefined ? {} : { handsOver: true as const }),
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
