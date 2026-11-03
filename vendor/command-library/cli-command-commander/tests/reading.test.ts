import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import { defineCommand, reject, strip } from "@steme-lab/cli-command";
import { call } from "./support/memory-io.ts";
import { makeTodos, programOf } from "./support/todos.ts";

const env = { TODOS_DB: "db", PATH: "/bin" };

/** A command whose flags convert a string, and whose second argument is optional. It decodes
 *  `count` with `FiniteFromString`: `NumberFromString` takes `x` as NaN, so would not refuse it. */
function makeCounting() {
  const run = vi.fn((_input: unknown) => Effect.succeed("counted"));
  const count = defineCommand({
    name: "count",
    summary: "count things",
    input: {
      args: reject(
        Schema.Tuple([Schema.String, Schema.optionalKey(Schema.String)]),
      ),
      flags: reject(Schema.Struct({ count: Schema.FiniteFromString })),
    },
    exits: {},
    run: ({ input }) => run(input),
    output: strip(Schema.String),
    render: (text) => text,
  });
  return { count, run };
}

describe("each source reaches run decoded", () => {
  it("hands args by position, kebab-case options as switches, and the stripped env", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, {
      argv: ["rename-todo", "t1", "--to", "one", "--dry-run"],
      env,
    });
    expect(result.code).toBe(0);
    expect(todos.run).toHaveBeenCalledTimes(1);
    expect(todos.run).toHaveBeenCalledWith({
      args: ["t1"],
      flags: { to: "one", dryRun: true },
      env: { TODOS_DB: "db" },
    });
    expect(result.out.join("")).toBe("t1 one\n");
  });

  it("leaves a switch that is not given out of the flags", async () => {
    const todos = makeTodos();
    const result = await call(todos.program, {
      argv: ["rename-todo", "t1", "--to", "one"],
      env,
    });
    expect(result.code).toBe(0);
    const [input] = todos.run.mock.calls[0] ?? [];
    expect(input?.flags).toEqual({ to: "one" });
    expect(input?.flags).not.toHaveProperty("dryRun");
  });

  it("converts a string with the contract, and leaves an optional argument absent", async () => {
    const { count, run } = makeCounting();
    const result = await call(programOf([count]), {
      argv: ["count", "a", "--count", "3"],
    });
    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith({ args: ["a"], flags: { count: 3 } });
    expect(result.out.join("")).toBe("counted\n");
  });

  it("hands an optional argument that is given", async () => {
    const { count, run } = makeCounting();
    const result = await call(programOf([count]), {
      argv: ["count", "a", "b", "--count", "3"],
    });
    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith({ args: ["a", "b"], flags: { count: 3 } });
  });

  it("hands run only the sources the command declares", async () => {
    const todos = makeTodos();
    await call(todos.program, { argv: ["list-todos"], env });
    expect(todos.listRun).toHaveBeenCalledTimes(1);
  });
});

describe("a refused call runs nothing and answers refused", () => {
  const { count, run: countRun } = makeCounting();
  const todos = makeTodos({
    commands: [...makeTodos().program.commands, count],
  });

  const refused: ReadonlyArray<{
    readonly argv: ReadonlyArray<string>;
    readonly names?: string;
  }> = [
    { argv: ["rename-todo", "t1", "--to", "one", "--force"], names: "--force" },
    { argv: ["rename-todo"] },
    { argv: ["rename-todo", "t1", "t2", "--to", "one"], names: "t2" },
    { argv: ["list-todos", "extra"], names: "extra" },
    { argv: ["list-todos", "--x"], names: "--x" },
    { argv: ["frobnicate"], names: "frobnicate" },
    { argv: ["count", "a", "--count", "x"], names: "flags" },
    { argv: [] },
  ];

  for (const { argv, names } of refused) {
    it(`refuses \`${argv.join(" ")}\``, async () => {
      const result = await call(todos.program, { argv, env });
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      expect(result.err.length).toBeGreaterThan(0);
      expect(todos.run).not.toHaveBeenCalled();
      expect(todos.listRun).not.toHaveBeenCalled();
      expect(countRun).not.toHaveBeenCalled();
      if (names !== undefined) expect(result.err.join("")).toContain(names);
    });
  }

  it("ends every message on err with a newline", async () => {
    const result = await call(todos.program, {
      argv: ["rename-todo", "t1", "t2", "--to", "one"],
      env,
    });
    for (const message of result.err) expect(message.endsWith("\n")).toBe(true);
  });
});
