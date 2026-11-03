import { afterEach, describe, expect, it, vi } from "vitest";
import { defineProgram } from "../../../../src/cli/commandLibrary/contract/index.js";
import { listTodos, renameTodo } from "../support/renameTodo.js";
import { call } from "./support/memoryIo.js";

const todos = defineProgram({
  name: "todos",
  version: "1.0.0",
  exits: { refused: 2, defect: 70 },
  commands: [renameTodo, listTodos],
});

const env = { TODOS_DB: "db" };

// The sample's `rename` is only declared: a call that reaches its run dies.
const renameRun = vi.spyOn(renameTodo, "run");

afterEach(() => {
  renameRun.mockClear();
});

describe("the sample commands, run up to rename-todo's run", () => {
  const refused: ReadonlyArray<ReadonlyArray<string>> = [
    ["rename-todo", "t1", "--to", "one", "--force"],
    ["rename-todo"],
    ["rename-todo", "t1", "t2", "--to", "one"],
    ["list-todos", "extra"],
    ["frobnicate"],
    [],
  ];

  for (const argv of refused) {
    it(`refuses \`${argv.join(" ")}\` with 2 and writes nothing to out`, async () => {
      const result = await call(todos, { argv, env });
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      expect(result.err.length).toBeGreaterThan(0);
      expect(renameRun).not.toHaveBeenCalled();
    });
  }

  it("names the surplus argument", async () => {
    const result = await call(todos, {
      argv: ["rename-todo", "t1", "t2", "--to", "one"],
      env,
    });
    expect(result.err.join("")).toContain("t2");
  });

  it("runs list-todos and renders a and b on two lines", async () => {
    const result = await call(todos, { argv: ["list-todos"] });
    expect(result.code).toBe(0);
    expect(result.out.join("")).toBe("a\nb\n");
    expect(result.err).toEqual([]);
  });

  for (const argv of [["--help"], ["rename-todo", "--help"], ["--version"]]) {
    it(`answers \`${argv.join(" ")}\` with 0`, async () => {
      const result = await call(todos, { argv });
      expect(result.code).toBe(0);
      expect(result.out.join("")).not.toBe("");
      expect(result.err).toEqual([]);
      expect(renameRun).not.toHaveBeenCalled();
    });
  }
});
