import { Data, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { defineCommand, reject, strip } from "@steme-lab/cli-command";
import {
  TodoArchived,
  TodoNotFound,
  TodoView,
} from "../../cli-command/rename-todo.command.ts";
import { call } from "./support/memory-io.ts";
import {
  makeTodos,
  programOf,
  type RenameRun,
  type RenameValue,
} from "./support/todos.ts";

const env = { TODOS_DB: "db" };
const terminal = { columns: 40, color: false };
const rename = ["rename-todo", "t1", "--to", "one"];

/** A value with a key the contract does not declare, past the types. */
const withExtra: RenameRun = () =>
  Effect.succeed({
    id: "t1",
    name: "one",
    archived: false,
  } as unknown as RenameValue);

describe("the output, reduced before render", () => {
  it("strip drops the excess and render receives the terminal", async () => {
    const render = vi.fn((todo: RenameValue) => `${todo.id} ${todo.name}`);
    const todos = makeTodos({
      run: withExtra,
      render,
      output: strip(TodoView),
    });
    const result = await call(todos.program, {
      argv: rename,
      env,
      ...terminal,
    });
    expect(render).toHaveBeenCalledWith({ id: "t1", name: "one" }, terminal);
    expect(result.out).toEqual(["t1 one\n"]);
    expect(result.code).toBe(0);
  });

  it("reject makes an excess key a defect, with out empty", async () => {
    const render = vi.fn((todo: RenameValue) => todo.id);
    const todos = makeTodos({
      run: withExtra,
      render,
      output: reject(TodoView),
    });
    const result = await call(todos.program, {
      argv: rename,
      env,
      ...terminal,
    });
    expect(render).not.toHaveBeenCalled();
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("defect:");
    expect(result.code).toBe(70);
  });

  it("without an output contract, render receives the value itself", async () => {
    const names = ["a", "b"];
    const listRender = vi.fn((value: ReadonlyArray<string>) => value.join(","));
    const todos = makeTodos({ listRender });
    todos.listRun.mockReturnValue(Effect.succeed(names));
    const result = await call(todos.program, { argv: ["list-todos"] });
    expect(listRender.mock.calls[0]?.[0]).toBe(names);
    expect(result.out).toEqual(["a,b\n"]);
  });
});

class Gone extends Data.TaggedError("Gone")<{}> {}
class EmptyName extends Data.TaggedError("EmptyName")<{}> {}
class Big extends Data.TaggedError("Big")<{
  readonly n: bigint;
  readonly loop?: unknown;
}> {}

describe("errors to their codes, defects to the defect code", () => {
  const failing =
    (effect: Effect.Effect<RenameValue, never>): RenameRun =>
    () =>
      effect as unknown as ReturnType<RenameRun>;

  it("a declared error ends with its code, its tag and fields on err", async () => {
    const todos = makeTodos({
      run: () => Effect.fail(new TodoNotFound({ id: "t9" })),
    });
    const result = await call(todos.program, { argv: rename, env });
    expect(result.err).toEqual(['TodoNotFound {"id":"t9"}\n']);
    expect(result.out).toEqual([]);
    expect(result.code).toBe(3);
  });

  const defects: ReadonlyArray<
    readonly [string, RenameRun, (value: RenameValue) => string]
  > = [
    ["an unmapped tag", failing(Effect.fail(new Gone()) as never), (t) => t.id],
    ["an untagged failure", failing(Effect.fail("boom") as never), (t) => t.id],
    ["a die", failing(Effect.die(new Error("died")) as never), (t) => t.id],
    [
      "a throwing render",
      () => Effect.succeed({ id: "t1", name: "one" }),
      () => {
        throw new Error("render broke");
      },
    ],
  ];
  it.each(defects)("%s is a defect", async (_name, run, render) => {
    const todos = makeTodos({ run, render });
    const result = await call(todos.program, { argv: rename, env });
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toMatch(/^defect: /);
    expect(result.code).toBe(70);
  });

  it("a mapped error with a bigint field ends with its code", async () => {
    const command = defineCommand({
      name: "big",
      summary: "fails with a bigint",
      input: {},
      exits: { Big: 5 },
      run: () => Effect.fail(new Big({ n: 1n })),
      render: () => "",
    });
    const result = await call(programOf([command]), { argv: ["big"] });
    expect(result.err).toEqual(['Big {"n":1n}\n']);
    expect(result.out).toEqual([]);
    expect(result.code).toBe(5);
  });

  it("a mapped error with a field JSON cannot encode ends with its code", async () => {
    const loop: { self?: unknown } = {};
    loop.self = loop;
    const command = defineCommand({
      name: "loop",
      summary: "fails with a circular field",
      input: {},
      exits: { Big: 6 },
      run: () => Effect.fail(new Big({ n: 2n, loop })),
      render: () => "",
    });
    const result = await call(programOf([command]), { argv: ["loop"] });
    expect(result.err.join("")).toMatch(/^Big /);
    expect(result.code).toBe(6);
  });

  it("a mapped EmptyName ends with its code", async () => {
    const command = defineCommand({
      name: "make",
      summary: "make one",
      input: {},
      exits: { EmptyName: 2 },
      run: () => Effect.fail(new EmptyName()),
      render: () => "",
    });
    const result = await call(programOf([command]), { argv: ["make"] });
    expect(result.err.join("")).toContain("EmptyName");
    expect(result.code).toBe(2);
  });

  it("a mapped tag may answer the program's refused code", async () => {
    const todos = makeTodos({
      run: () => Effect.fail(new TodoArchived({ id: "t1" })),
      exits: { TodoNotFound: 3, TodoArchived: 2 },
    });
    const result = await call(todos.program, { argv: rename, env });
    expect(result.code).toBe(2);
  });
});

describe("a command may not answer with the defect code", () => {
  it.each([["list-todos"], rename])(
    "%s runs nothing, ends 70",
    async (...argv) => {
      const todos = makeTodos({ exits: { TodoNotFound: 3, TodoArchived: 70 } });
      const result = await call(todos.program, { argv: argv.flat(), env });
      expect(todos.runs()).toBe(0);
      expect(result.out).toEqual([]);
      const err = result.err.join("");
      expect(err).toContain("rename-todo");
      expect(err).toContain("70");
      expect(result.code).toBe(70);
    },
  );
});

describe("the calls that reach rename-todo's run", () => {
  it("renders t1 one and ends 0", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, { argv: rename, env });
    expect(result.out).toEqual(["t1 one\n"]);
    expect(result.code).toBe(0);
  });

  it("hands run dryRun: true", async () => {
    const todos = makeTodos();
    await call(todos.program, { argv: [...rename, "--dry-run"], env });
    expect(todos.run.mock.calls[0]?.[0].flags).toEqual({
      to: "one",
      dryRun: true,
    });
  });

  it("maps TodoNotFound to 3", async () => {
    const todos = makeTodos({
      run: () => Effect.fail(new TodoNotFound({ id: "t9" })),
    });
    const result = await call(todos.program, {
      argv: ["rename-todo", "t9", "--to", "x"],
      env,
    });
    expect(result.err.join("")).toContain("TodoNotFound");
    expect(result.code).toBe(3);
  });
});
