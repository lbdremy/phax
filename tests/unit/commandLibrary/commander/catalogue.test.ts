import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  catalogue,
  commandContract,
  defineCommand,
  reject,
  strip,
  Written,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { call } from "./support/memoryIo.js";
import { makeTodos, programOf } from "./support/todos.js";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

const Item = Schema.Struct({
  id: Schema.String,
  count: Schema.NumberFromString,
}).annotations({ identifier: "item" });

/** A command with every kind of source, an output and a declared error. */
const full = defineCommand({
  name: "full",
  summary: "full",
  input: {
    args: reject(Schema.Tuple(Schema.String, Schema.optionalElement(Schema.String))),
    flags: reject(
      Schema.Struct({
        dryRun: Schema.optionalKey(Schema.Boolean),
        limit: Schema.NumberFromString,
      }),
    ),
    stdin: reject(Item, { flag: "request", required: true }),
  },
  output: strip(Item),
  exits: { Missing: 3 },
  errors: { Missing: Schema.Struct({ id: Schema.String }) },
  run: () => Effect.succeed({ id: "x", count: 1 }),
});

interface Parsed {
  readonly code: number;
  readonly value: unknown;
  readonly err: string;
}

const parsed = async (
  program: ReturnType<typeof programOf>,
  argv: ReadonlyArray<string>,
): Promise<Parsed> => {
  const result = await call(program, { argv });
  return {
    code: result.code,
    value: JSON.parse(result.out.join("")) as unknown,
    err: result.err.join(""),
  };
};

describe("the program's contracts", () => {
  it("lists every command, the exit codes and the message lines, and writes nothing else", async () => {
    const todos = makeTodos();
    const { code, value, err } = await parsed(todos.program, ["--json-schema"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(Object.keys(Object(value))).toEqual([
      "program",
      "version",
      "exits",
      "commands",
      "messages",
    ]);
    expect(value).toMatchObject({
      program: "todos",
      version: "1.0.0",
      exits: { refused: 2, defect: 70 },
    });
    expect(Reflect.get(Object(value), "commands")).toMatchObject([
      { name: ["rename-todo"] },
      { name: ["list-todos"] },
    ]);
    expect(todos.runs()).toBe(0);
  });

  it("is equal to what catalogue() builds, in the layout stdout carries", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, { argv: ["--json-schema"] });
    expect(result.out).toEqual([`${JSON.stringify(catalogue(todos.program), null, 2)}\n`]);
  });

  it("publishes the shape of each message line, once", async () => {
    const { value } = await parsed(makeTodos().program, ["--json-schema"]);
    const messages: unknown = Reflect.get(Object(value), "messages");
    expect(Object.keys(Object(messages))).toEqual([
      "note",
      "written",
      "error",
      "refused",
      "defect",
    ]);
    for (const schema of Object.values(Object(messages))) {
      expect(Reflect.get(Object(schema), "$schema")).toBe(DIALECT);
    }
    expect(Reflect.get(Object(Reflect.get(Object(messages), "refused")), "required")).toEqual([
      "kind",
      "source",
      "path",
      "expected",
      "text",
      "exit",
    ]);
  });

  it("is refused for an unknown command, which runs and reads nothing", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, {
      argv: ["frobnicate", "--json-schema"],
    });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
  });

  it("is not the program's when it is not the only word", async () => {
    const result = await call(makeTodos().program, {
      argv: ["--json-schema", "list-todos"],
    });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
  });
});

describe("a command's contracts", () => {
  it("prints its entry alone, equal to its entry in the program's, and runs nothing", async () => {
    const todos = makeTodos();
    const whole = await parsed(todos.program, ["--json-schema"]);
    const one = await parsed(todos.program, ["rename-todo", "--json-schema"]);
    const entries = Reflect.get(Object(whole.value), "commands") as ReadonlyArray<unknown>;
    expect(one.code).toBe(0);
    expect(one.err).toBe("");
    expect(one.value).toEqual(entries[0]);
    expect(todos.runs()).toBe(0);
  });

  it("answers --json-schema before anything is read or decoded", async () => {
    const result = await call(programOf([full]), {
      argv: ["full", "--json-schema", "--bogus", "--request=nowhere"],
    });
    expect(result.code).toBe(0);
    expect(result.stdinReads()).toBe(0);
    expect(result.fileReads()).toEqual([]);
  });

  it("describes positionals as arg<index> and options as written, in 2020-12", async () => {
    const entry = commandContract(programOf([full]), "full");
    expect(entry?.name).toEqual(["full"]);
    expect(entry?.input).toMatchObject({
      $schema: DIALECT,
      type: "object",
      required: ["arg0", "limit"],
      additionalProperties: false,
    });
    expect(Object.keys(Object(entry?.input["properties"]))).toEqual([
      "arg0",
      "arg1",
      "dry-run",
      "limit",
    ]);
    // `limit` is a number on the command line: its encoded side is a string.
    expect(Reflect.get(Object(Object(entry?.input["properties"])["limit"]), "type")).toBe("string");
  });

  it("describes the stdin read: its flag as written, whether it is required, its schema", () => {
    const entry = commandContract(programOf([full]), "full");
    expect(entry?.stdin).toMatchObject({ flag: "--request", required: true });
    expect(entry?.stdin?.schema["$schema"]).toBe(DIALECT);
    expect(entry?.stdin?.schema).toHaveProperty("$defs.item");
  });

  it("describes a read with no flag as required, and no read as null", () => {
    const unbound = defineCommand({
      name: "unbound",
      summary: "unbound",
      input: { stdin: strip(Schema.Struct({ a: Schema.String })) },
      output: strip(Schema.String),
      exits: {},
      run: () => Effect.succeed("x"),
    });
    const bare = defineCommand({
      name: "bare",
      summary: "bare",
      input: {},
      exits: {},
      run: () => Effect.void,
    });
    const program = programOf([unbound, bare]);
    expect(commandContract(program, "unbound")?.stdin).toMatchObject({
      flag: null,
      required: true,
    });
    expect(commandContract(program, "bare")).toMatchObject({
      stdin: null,
      output: null,
      errors: [],
    });
  });

  it("describes the output by its encoded side", () => {
    const entry = commandContract(programOf([full]), "full");
    expect(entry?.output?.["$schema"]).toBe(DIALECT);
    expect(entry?.output).toHaveProperty("$defs.item.properties.count.type", "string");
  });

  it("lists each error with its code and its fields, `{}` when none are declared", () => {
    const undeclared = defineCommand({
      name: "undeclared",
      summary: "undeclared",
      input: {},
      output: strip(Schema.String),
      exits: { Missing: 4 },
      run: () => Effect.succeed("x"),
    });
    const program = programOf([full, undeclared]);
    const declared = commandContract(program, "full")?.errors;
    expect(declared).toMatchObject([{ tag: "Missing", exit: 3 }]);
    expect(declared?.[0]?.fields).toMatchObject({
      $schema: DIALECT,
      type: "object",
      required: ["id"],
    });
    expect(commandContract(program, "undeclared")?.errors).toEqual([
      { tag: "Missing", exit: 4, fields: {} },
    ]);
  });

  it("leaves out of an error's fields the written files its line lifts to its own key", () => {
    const partial = defineCommand({
      name: "partial",
      summary: "partial",
      input: {},
      output: strip(Schema.String),
      exits: { Stopped: 2 },
      errors: {
        Stopped: Schema.Struct({
          diagnostics: Schema.Array(Schema.String),
          written: Schema.Array(Written),
        }),
      },
      run: () => Effect.succeed("x"),
    });
    const [stopped] = commandContract(programOf([partial]), "partial")?.errors ?? [];
    expect(stopped?.fields).toMatchObject({ required: ["diagnostics"] });
    expect(Object.keys(Object(Reflect.get(Object(stopped?.fields), "properties")))).toEqual([
      "diagnostics",
    ]);
  });

  it("opens an object whose command strips what it does not declare", () => {
    const stripping = defineCommand({
      name: "stripping",
      summary: "stripping",
      input: { flags: strip(Schema.Struct({ to: Schema.String })) },
      output: strip(Schema.String),
      exits: {},
      run: () => Effect.succeed("x"),
    });
    expect(commandContract(programOf([stripping]), "stripping")?.input).toMatchObject({
      additionalProperties: true,
      required: ["to"],
    });
  });

  it("is undefined for a command the program does not have", () => {
    expect(commandContract(programOf([full]), "nope")).toBeUndefined();
  });
});
