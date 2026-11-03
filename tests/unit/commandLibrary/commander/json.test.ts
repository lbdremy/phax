import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import { runner } from "../../../../src/cli/commandLibrary/commander/index.js";
import {
  defineCommand,
  document,
  DocumentOutput,
  reject,
  strip,
  type ExitCode,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { TodoNotFound } from "../support/renameTodo.js";
import { call, memoryIo } from "./support/memoryIo.js";
import { makeTodos, programOf } from "./support/todos.js";

const env = { TODOS_DB: "db" };
const rename = ["rename-todo", "t1", "--to", "one"];

/** The lines of stderr, each parsed. */
const lines = (err: ReadonlyArray<string>): ReadonlyArray<unknown> =>
  err
    .join("")
    .split("\n")
    .filter((each) => each !== "")
    .map((each): unknown => JSON.parse(each));

describe("--json", () => {
  it("writes the encoded output, two-space indented, and never renders", async () => {
    const render = vi.fn((todo: { id: string; name: string }) => todo.id);
    const todos = makeTodos({ render });
    const result = await call(todos.program, {
      argv: [...rename, "--json"],
      env,
    });
    expect(result.code).toBe(0);
    expect(result.out.join("")).toBe(`${JSON.stringify({ id: "t1", name: "one" }, null, 2)}\n`);
    expect(result.err).toEqual([]);
    expect(render).not.toHaveBeenCalled();
  });

  it("is read anywhere after the command's name, and not after `--`", async () => {
    const before = await call(makeTodos().program, {
      argv: ["rename-todo", "--json", "t1", "--to", "one"],
      env,
    });
    expect(before.code).toBe(0);
    expect(before.out.join("")).toContain('"id": "t1"');

    // After `--` it is a positional argument: one too many for `rename-todo`.
    const after = await call(makeTodos().program, {
      argv: [...rename, "--", "--json"],
      env,
    });
    expect(after.code).toBe(2);
    expect(after.out).toEqual([]);
    expect(after.err.join("")).toContain("too many arguments: --json");
  });

  it("leaves help and the version as text", async () => {
    for (const argv of [
      ["rename-todo", "--help", "--json"],
      ["list-todos", "--json", "-h"],
    ]) {
      const result = await call(makeTodos().program, { argv, env });
      expect(result.code, argv.join(" ")).toBe(0);
      expect(result.out.join("")).toContain("Usage:");
      expect(result.err).toEqual([]);
    }
  });

  it("lists --json and --json-schema on a command's help", async () => {
    const result = await call(makeTodos().program, {
      argv: ["rename-todo", "--help"],
    });
    const text = result.out.join("");
    expect(text).toContain("--json ");
    expect(text).toContain("--json-schema");
  });

  it("writes a declared error as exactly one line with its code", async () => {
    const todos = makeTodos({
      run: () => Effect.fail(new TodoNotFound({ id: "t1" })),
    });
    const result = await call(todos.program, {
      argv: [...rename, "--json"],
      env,
    });
    expect(result.code).toBe(3);
    expect(result.out).toEqual([]);
    expect(result.err).toEqual([
      '{"kind":"error","error":"TodoNotFound","exit":3,"fields":{"id":"t1"},"written":[]}\n',
    ]);
  });

  it("writes an error no exit maps as a defect line", async () => {
    const todos = makeTodos({
      run: () => Effect.fail(new NotFound({ id: "t1" })) as never,
    });
    const result = await call(todos.program, {
      argv: [...rename, "--json"],
      env,
    });
    expect(result.code).toBe(70);
    expect(result.out).toEqual([]);
    const [only, ...rest] = lines(result.err);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ kind: "defect", exit: 70 });
  });

  it("writes an unknown command as a refused line naming the word", async () => {
    const result = await call(makeTodos().program, {
      argv: ["frobnicate", "--json"],
      env,
    });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
    expect(lines(result.err)).toEqual([
      {
        kind: "refused",
        source: "command",
        path: ["frobnicate"],
        expected: "one of rename-todo, list-todos",
        text: "error: unknown command 'frobnicate'",
        exit: 2,
      },
    ]);
  });

  const refusals: ReadonlyArray<{
    readonly why: string;
    readonly argv: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
    readonly source: string;
    readonly path: ReadonlyArray<string>;
  }> = [
    {
      why: "a missing argument",
      argv: ["rename-todo", "--to", "one"],
      source: "args",
      path: ["arg0"],
    },
    {
      why: "a missing option",
      argv: ["rename-todo", "t1"],
      source: "flags",
      path: ["--to"],
    },
    {
      why: "an unknown option",
      argv: [...rename, "--force"],
      source: "flags",
      path: ["--force"],
    },
    {
      why: "too many arguments",
      argv: [...rename, "t2"],
      source: "args",
      path: ["arg1"],
    },
    {
      why: "an option given no value",
      argv: ["rename-todo", "t1", "--to"],
      source: "flags",
      path: ["--to"],
    },
  ];
  for (const refusal of refusals) {
    it(`writes ${refusal.why} as one refused line`, async () => {
      const result = await call(makeTodos().program, {
        argv: [...refusal.argv, "--json"],
        env: refusal.env ?? env,
      });
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      const found = lines(result.err);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        kind: "refused",
        source: refusal.source,
        path: refusal.path,
        exit: 2,
      });
      // The text is the one the call is refused with without --json.
      const plain = await call(makeTodos().program, {
        argv: refusal.argv,
        env: refusal.env ?? env,
      });
      expect(Reflect.get(Object(found[0]), "text")).toBe(plain.err.join("").replace(/\n$/, ""));
    });
  }

  it("names an environment variable that does not decode by its name", async () => {
    const result = await call(makeTodos().program, {
      argv: [...rename, "--json"],
      env: {},
    });
    expect(result.code).toBe(2);
    expect(lines(result.err)).toMatchObject([
      { kind: "refused", source: "env", path: ["TODOS_DB"] },
    ]);
  });

  it("names a nested stdin key by its path", async () => {
    const Doc = Schema.Struct({
      todos: Schema.Array(Schema.Struct({ id: Schema.String })),
    });
    const command = defineCommand({
      name: "load",
      summary: "load",
      input: { stdin: reject(Doc) },
      output: strip(Schema.String),
      exits: {},
      run: () => Effect.succeed("ok"),
    });
    const result = await call(programOf([command]), {
      argv: ["load", "--json"],
      stdin: JSON.stringify({ todos: [{ id: 1 }] }),
    });
    expect(result.code).toBe(2);
    expect(lines(result.err)).toMatchObject([
      { kind: "refused", source: "stdin", path: ["todos", "0", "id"] },
    ]);
  });

  it("writes the flag's own refusals as refused lines of stdin", async () => {
    const command = defineCommand({
      name: "audit",
      summary: "audit",
      input: {
        stdin: reject(Schema.Struct({ todos: Schema.Array(Schema.String) }), {
          flag: "request",
          required: true,
        }),
      },
      output: strip(Schema.String),
      exits: {},
      run: () => Effect.succeed("ok"),
    });
    const absent = await call(programOf([command]), {
      argv: ["audit", "--json"],
    });
    expect(absent.code).toBe(2);
    expect(lines(absent.err)).toMatchObject([
      { kind: "refused", source: "stdin", path: ["--request"] },
    ]);
    const terminal = await call(programOf([command]), {
      argv: ["audit", "--request", "--json"],
      stdinIsTerminal: true,
    });
    expect(terminal.code).toBe(2);
    expect(lines(terminal.err)).toMatchObject([
      { kind: "refused", source: "stdin", path: ["--request"] },
    ]);
    expect(terminal.stdinReads()).toBe(0);
  });

  it("writes a defect as one line with today's text", async () => {
    const dies = defineCommand({
      name: "dies",
      summary: "dies",
      input: {},
      exits: {},
      run: () => Effect.die(new Error("boom")),
    });
    const text = await call(programOf([dies]), { argv: ["dies"] });
    const json = await call(programOf([dies]), { argv: ["dies", "--json"] });
    expect(json.code).toBe(70);
    expect(json.out).toEqual([]);
    expect(lines(json.err)).toEqual([
      {
        kind: "defect",
        text: text.err.join("").replace(/\n$/, ""),
        exit: 70,
      },
    ]);
  });

  it("writes a defect for an output that does not encode, with nothing on stdout", async () => {
    const todos = makeTodos({
      run: () => Effect.succeed({ id: 1 } as never),
    });
    const result = await call(todos.program, {
      argv: [...rename, "--json"],
      env,
    });
    expect(result.code).toBe(70);
    expect(result.out).toEqual([]);
    expect(lines(result.err)).toMatchObject([{ kind: "defect", exit: 70 }]);
  });
});

class Broken extends Data.TaggedError("Broken")<{
  readonly count: bigint;
}> {}
class Writes extends Data.TaggedError("Writes")<{
  readonly written: string;
}> {}
class NotFound extends Data.TaggedError("NotFound")<{
  readonly id: string;
}> {}

/** A command whose run fails with `error`, mapped to 5. */
const failing = (error: Broken | Writes, tag: "Broken" | "Writes") =>
  defineCommand({
    name: "fails",
    summary: "fails",
    input: {},
    exits: { [tag]: 5 } as { readonly Broken: 5 } & { readonly Writes: 5 },
    run: () => Effect.fail(error as never),
  });

describe("a declared error's fields under --json", () => {
  it("is a defect when a field JSON cannot encode (a bigint)", async () => {
    const result = await call(programOf([failing(new Broken({ count: 1n }), "Broken")]), {
      argv: ["fails", "--json"],
    });
    expect(result.code).toBe(70);
    const [only, ...rest] = lines(result.err);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ kind: "defect", exit: 70 });
    expect(Reflect.get(Object(only), "text")).toContain("Broken");
  });

  it("is a defect when `written` is not an array of written-file records", async () => {
    const result = await call(programOf([failing(new Writes({ written: "no" }), "Writes")]), {
      argv: ["fails", "--json"],
    });
    expect(result.code).toBe(70);
    expect(lines(result.err)).toMatchObject([{ kind: "defect", exit: 70 }]);
  });

  it("keeps the text form as it was", async () => {
    const result = await call(programOf([failing(new Writes({ written: "no" }), "Writes")]), {
      argv: ["fails"],
    });
    expect(result.code).toBe(5);
    expect(result.err.join("")).toBe('Writes {"written":"no"}\n');
  });
});

const FORMAT = "https://example.test/schemas/doc/1.0.0.json";
const BYTES = `{\n  "$schema": "${FORMAT}",\n  "k": 1\n}\n`;

/** A command that answers a document, optionally one it writes, with notes beside it. */
function emitting(options: { readonly writes: boolean }) {
  const output = strip(Schema.Struct({ ...DocumentOutput.fields, k: Schema.Number }));
  const base = {
    name: "emit",
    summary: "emit a document",
    input: {},
    output,
    exits: {},
    run: () => Effect.succeed({ $schema: FORMAT, k: 1 }),
    document: () => document(BYTES, { format: FORMAT }),
    notes: () => "done",
  } as const;
  return options.writes ? defineCommand({ ...base, writesDocument: true }) : defineCommand(base);
}

describe("a document and --out", () => {
  it("writes the document's bytes as they are, and the notes after", async () => {
    const text = await call(programOf([emitting({ writes: false })]), {
      argv: ["emit"],
    });
    expect(text.out).toEqual([BYTES]);
    expect(text.err).toEqual(["done\n"]);
    const json = await call(programOf([emitting({ writes: false })]), {
      argv: ["emit", "--json"],
    });
    expect(json.out).toEqual([BYTES]);
    expect(lines(json.err)).toEqual([{ kind: "note", text: "done" }]);
  });

  it("takes --out only from a command that writes a document", async () => {
    const result = await call(programOf([emitting({ writes: false })]), {
      argv: ["emit", "--out", "a.json"],
    });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toContain("unknown option '--out'");
  });

  it("writes the file and answers its record, which names the document's format", async () => {
    const result = await call(programOf([emitting({ writes: true })]), {
      argv: ["emit", "--out=a.json", "--json"],
    });
    expect(result.code).toBe(0);
    expect(result.fileWrites()).toEqual({ "a.json": BYTES });
    const record: unknown = JSON.parse(result.out.join(""));
    expect(record).toMatchObject({ path: "a.json", format: FORMAT });
    expect(Reflect.get(Object(record), "digest")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(lines(result.err)).toEqual([{ kind: "note", text: "done" }]);
  });

  it("lists --out on the help of a command that writes a document", async () => {
    const result = await call(programOf([emitting({ writes: true })]), {
      argv: ["emit", "--help"],
    });
    expect(result.out.join("")).toContain("--out <path>");
  });

  it("refuses --out given no path", async () => {
    for (const argv of [
      ["emit", "--out"],
      ["emit", "--out", "--json"],
      ["emit", "--out="],
    ]) {
      const result = await call(programOf([emitting({ writes: true })]), {
        argv,
      });
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.fileWrites()).toEqual({});
    }
    const json = await call(programOf([emitting({ writes: true })]), {
      argv: ["emit", "--out", "--json"],
    });
    expect(lines(json.err)).toMatchObject([{ kind: "refused", source: "flags", path: ["--out"] }]);
  });

  it("refuses a path it cannot write, as one refused line", async () => {
    const memory = memoryIo({
      argv: ["emit", "--out", "/nope/a.json", "--json"],
    });
    const io = {
      ...memory.io,
      writeFile: () => Effect.fail("no such directory"),
    };
    const code = await Effect.runPromise(
      runner.run(programOf([emitting({ writes: true })]), io) as Effect.Effect<ExitCode>,
    );
    expect(code).toBe(2);
    expect(memory.out).toEqual([]);
    expect(lines(memory.err)).toMatchObject([
      {
        kind: "refused",
        source: "flags",
        path: ["--out"],
        text: "error: --out: /nope/a.json: no such directory",
        exit: 2,
      },
    ]);
  });
});

describe("the names the runner owns", () => {
  it("stops the program, as a defect line under --json", async () => {
    const clash = defineCommand({
      name: "loud",
      summary: "declares --json",
      input: { flags: reject(Schema.Struct({ json: Schema.Boolean })) },
      output: strip(Schema.String),
      exits: {},
      run: () => Effect.succeed("x"),
    });
    const text = await call(programOf([clash]), { argv: ["loud"] });
    expect(text.code).toBe(70);
    expect(text.err).toEqual(["error: loud declares --json, which the runner reserves\n"]);
    const json = await call(programOf([clash]), { argv: ["loud", "--json"] });
    expect(json.code).toBe(70);
    expect(lines(json.err)).toEqual([
      {
        kind: "defect",
        text: "error: loud declares --json, which the runner reserves",
        exit: 70,
      },
    ]);
  });

  it("counts a stdin flag of a reserved name", async () => {
    const clash = defineCommand({
      name: "loud",
      summary: "binds --json-schema",
      input: {
        stdin: reject(Schema.Struct({}), { flag: "json-schema" }),
      },
      output: strip(Schema.String),
      exits: {},
      run: () => Effect.succeed("x"),
    });
    const result = await call(programOf([clash]), { argv: ["loud"] });
    expect(result.code).toBe(70);
    expect(result.err.join("")).toContain("--json-schema");
  });
});

// Gains carried for upstream under --json: progress notes, an error's text form, verdict codes.
describe("--json and the gains", () => {
  class Stalled extends Data.TaggedError("Stalled")<{ readonly step: number }> {}

  /** Reports two steps (the second on two lines), then fails with `Stalled` when told to. */
  const stepping = (fails: boolean) =>
    defineCommand({
      name: "steps",
      summary: "steps",
      input: {},
      output: strip(Schema.Struct({ done: Schema.Number })),
      exits: { Stalled: 6 },
      run: ({ progress }) =>
        Effect.gen(function* () {
          yield* progress("step one");
          yield* progress("step two\nstill two");
          if (fails) return yield* new Stalled({ step: 2 });
          return { done: 2 };
        }),
      texts: { Stalled: (error) => `stalled at step ${error.step}` },
      verdicts: { 1: (value) => value.done > 1 },
    });

  it("writes each progress line as a note line, before the output and its verdict", async () => {
    const memory = memoryIo({ argv: ["steps", "--json"] });
    const code = await Effect.runPromise(runner.run(programOf([stepping(false)]), memory.io));
    expect(code).toBe(1);
    expect(memory.err).toEqual([
      `{"kind":"note","text":"step one"}\n`,
      `{"kind":"note","text":"step two"}\n{"kind":"note","text":"still two"}\n`,
    ]);
    expect(memory.out).toEqual([`${JSON.stringify({ done: 2 }, null, 2)}\n`]);
  });

  it("writes progress as plain lines without --json", async () => {
    const result = await call(programOf([stepping(false)]), { argv: ["steps"] });
    expect(result.code).toBe(1);
    expect(result.err).toEqual(["step one\n", "step two\nstill two\n"]);
  });

  it("writes a declared error as its error line alone, never its text", async () => {
    const json = await call(programOf([stepping(true)]), { argv: ["steps", "--json"] });
    expect(json.code).toBe(6);
    expect(json.out).toEqual([]);
    expect(lines(json.err)).toEqual([
      { kind: "note", text: "step one" },
      { kind: "note", text: "step two" },
      { kind: "note", text: "still two" },
      { kind: "error", error: "Stalled", exit: 6, fields: { step: 2 }, written: [] },
    ]);
    const text = await call(programOf([stepping(true)]), { argv: ["steps"] });
    expect(text.code).toBe(6);
    expect(text.err.at(-1)).toBe("stalled at step 2\n");
  });
});
