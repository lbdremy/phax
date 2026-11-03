import * as Schema from "effect/Schema";
import type {
  Command,
  ExitCode,
  Inputs,
  Program,
  Source,
} from "../contracts/command.ts";
import { DIALECT, messageSchemas, type JsonSchema } from "./messages.ts";
import { argShapes, fullName, kebabCase } from "./shapes.ts";

/** What a command's stdin read is, for an agent: the flag that binds it (as written), whether the
 *  document is required, and its schema. */
export interface StdinContract {
  readonly flag: string | null;
  readonly required: boolean;
  readonly schema: JsonSchema;
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

const dictionaryOf = (value: unknown): Dictionary =>
  isDictionary(value) ? value : {};

/** Effect's JSON Schema of a contract's encoded side, with the shared definitions beside it:
 *  `schema` is the root, `definitions` what its `$ref`s name. */
function generated(
  contract: Schema.Top,
  undeclared: "reject" | "strip",
): { readonly schema: Dictionary; readonly definitions: Dictionary } {
  const document = Schema.toJsonSchemaDocument(
    contract as unknown as Schema.Constraint,
    { onExcessProperty: undeclared === "reject" ? "error" : "ignore" },
  );
  return {
    schema: dictionaryOf(document.schema),
    definitions: dictionaryOf(document.definitions),
  };
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
function schemaOf(
  contract: Schema.Top,
  undeclared: "reject" | "strip",
): JsonSchema {
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
    const { schema, definitions: defs } = generated(
      inputs.args.contract,
      inputs.args.undeclared,
    );
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
    const { schema, definitions: defs } = generated(
      inputs.flags.contract,
      inputs.flags.undeclared,
    );
    Object.assign(definitions, defs);
    const root = resolved(schema, defs);
    const fields = dictionaryOf(root["properties"]);
    const needed = Array.isArray(root["required"]) ? root["required"] : [];
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

function stdinOf(source: Source<Schema.Top> | undefined): StdinContract | null {
  if (source === undefined) return null;
  return {
    flag: source.flag === undefined ? null : `--${source.flag}`,
    required: source.flag === undefined ? true : source.required === true,
    schema: schemaOf(source.contract, source.undeclared),
  };
}

/** One command's contracts. */
export function commandEntry(command: Command<unknown>): CommandContract {
  const inputs: Inputs = command.input;
  const output: Source<Schema.Top> | undefined = command.output;
  const exits: Readonly<Record<string, ExitCode>> = command.exits;
  const declared: Readonly<Record<string, Schema.Top | undefined>> =
    command.errors ?? {};
  return {
    name: fullName(command),
    input: inputOf(inputs),
    stdin: stdinOf(inputs.stdin),
    output:
      output === undefined
        ? null
        : schemaOf(output.contract, output.undeclared),
    errors: Object.entries(exits).map(([tag, exit]) => {
      const fields = declared[tag];
      return {
        tag,
        exit,
        fields:
          fields === undefined ? {} : withoutWritten(schemaOf(fields, "strip")),
      };
    }),
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
