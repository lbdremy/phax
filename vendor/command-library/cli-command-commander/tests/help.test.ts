import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import { defineCommand, reject, strip } from "@steme-lab/cli-command";
import { call } from "./support/memory-io.ts";
import { makeTodos, programOf } from "./support/todos.ts";

describe("Commander's help and the version", () => {
  for (const flag of ["--help", "-h"]) {
    it(`lists the commands with their summaries on ${flag}`, async () => {
      const todos = makeTodos();
      const result = await call(todos.program, { argv: [flag] });
      const text = result.out.join("");
      expect(result.code).toBe(0);
      expect(result.err).toEqual([]);
      expect(text).toContain("rename-todo");
      expect(text).toContain("rename a todo");
      expect(text).toContain("list-todos");
      expect(text).toContain("list the todos");
      expect(todos.runs()).toBe(0);
    });
  }

  it("names a command's argument and options on its help", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, {
      argv: ["rename-todo", "--help"],
    });
    const text = result.out.join("");
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(text).toContain("<arg0>");
    expect(text).toContain("--to <to>");
    expect(text).toContain("--dry-run");
    expect(text).toContain("environment: TODOS_DB");
    expect(todos.runs()).toBe(0);
  });

  it("writes the program's version on --version", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, { argv: ["--version"] });
    expect(result.code).toBe(0);
    expect(result.out.join("").trim()).toBe("1.0.0");
    expect(result.err).toEqual([]);
    expect(todos.runs()).toBe(0);
  });

  it("answers the empty call with help on err and the refused code", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, { argv: [] });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("rename-todo");
  });
});

/** The tests' todos, with a command whose flags strip: every policy a word can meet. */
function withTagTodo() {
  const todos = makeTodos();
  const tagRun = vi.fn((_input: unknown) => Effect.succeed("tagged"));
  const tagTodo = defineCommand({
    name: "tag-todo",
    summary: "tag a todo",
    input: {
      args: reject(Schema.Tuple([Schema.String])),
      flags: strip(Schema.Struct({ to: Schema.String })),
    },
    exits: {},
    run: ({ input }) => tagRun(input),
    output: strip(Schema.String),
    render: (text) => text,
  });
  const [renameTodo, listTodos] = todos.program.commands;
  const program = programOf([
    renameTodo as (typeof todos.program.commands)[number],
    listTodos as (typeof todos.program.commands)[number],
    tagTodo,
  ]);
  return {
    program,
    runs: () => todos.runs() + tagRun.mock.calls.length,
  };
}

const env = { TODOS_DB: "db" };

describe("the version, answered only as the whole call `--version`", () => {
  const refused: ReadonlyArray<ReadonlyArray<string>> = [
    ["-V"],
    ["--version", "list-todos"],
    ["--version", "--help"],
    ["list-todos", "--version"],
    ["list-todos", "-V"],
    ["rename-todo", "t1", "--to", "one", "--version"],
    ["rename-todo", "t1", "--to", "one", "-V"],
    ["tag-todo", "t1", "--to", "one", "--version"],
  ];
  for (const argv of refused) {
    it(`refuses \`${argv.join(" ")}\`, running nothing`, async () => {
      const { program, runs } = withTagTodo();
      const result = await call(program, { argv, env });
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      expect(result.err.join("")).not.toBe("");
      expect(runs()).toBe(0);
    });
  }

  it("drops -V under flags strip, as any undeclared option", async () => {
    const { program, runs } = withTagTodo();
    const result = await call(program, {
      argv: ["tag-todo", "t1", "-V", "--to", "one"],
    });
    expect(result.code).toBe(0);
    expect(runs()).toBe(1);
  });
});

describe("help, answered where §5.31 answers it", () => {
  const answered: ReadonlyArray<ReadonlyArray<string>> = [
    ["list-todos", "--help"],
    ["list-todos", "-h"],
    ["rename-todo", "-h"],
    ["tag-todo", "t1", "--help"],
  ];
  for (const argv of answered) {
    it(`answers \`${argv.join(" ")}\` with the command's help`, async () => {
      const { program, runs } = withTagTodo();
      const result = await call(program, { argv, env });
      expect(result.code).toBe(0);
      expect(result.err).toEqual([]);
      expect(result.out.join("")).toContain(argv[0]);
      expect(runs()).toBe(0);
    });
  }

  const refused: ReadonlyArray<ReadonlyArray<string>> = [
    ["help"],
    ["help", "rename-todo"],
    ["--help", "rename-todo"],
    ["-h", "extra"],
  ];
  for (const argv of refused) {
    it(`refuses \`${argv.join(" ")}\`, running nothing`, async () => {
      const { program, runs } = withTagTodo();
      const result = await call(program, { argv, env });
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      expect(result.err.join("")).not.toBe("");
      expect(runs()).toBe(0);
    });
  }

  it("names help as an unknown command", async () => {
    const { program } = withTagTodo();
    const result = await call(program, { argv: ["help"] });
    expect(result.err.join("")).toContain("unknown command 'help'");
  });
});
