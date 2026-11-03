import { Data, Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runner } from "../../../../src/cli/commandLibrary/commander/index.js";
import type { ExitCode } from "../../../../src/cli/commandLibrary/contract/index.js";
import { TodoNotFound } from "../support/renameTodo.js";
import { memoryIo } from "./support/memoryIo.js";
import { makeTodos, type RenameRun } from "./support/todos.js";

class Gone extends Data.TaggedError("Gone")<{}> {}

const env = { TODOS_DB: "db" };
const rename = ["rename-todo", "t1", "--to", "one"];

const failWith =
  (effect: Effect.Effect<never, unknown>): RenameRun =>
  () =>
    effect as ReturnType<RenameRun>;

const calls: ReadonlyArray<
  readonly [string, ReadonlyArray<string>, Parameters<typeof makeTodos>[0]]
> = [
  ["a refusal", ["nope"], {}],
  ["a missing option", ["rename-todo", "t1"], {}],
  ["help", ["--help"], {}],
  ["-h", ["-h"], {}],
  ["the empty call", [], {}],
  ["version", ["--version"], {}],
  ["a success", rename, {}],
  ["a list", ["list-todos"], {}],
  ["a mapped error", rename, { run: () => Effect.fail(new TodoNotFound({ id: "t1" })) }],
  ["an unmapped tag", rename, { run: failWith(Effect.fail(new Gone())) }],
  ["an untagged failure", rename, { run: failWith(Effect.fail("boom")) }],
  ["a die", rename, { run: failWith(Effect.die(new Error("died"))) }],
  [
    "a throwing render",
    rename,
    {
      render: () => {
        throw new Error("render broke");
      },
    },
  ],
  ["a defect-code collision", rename, { exits: { TodoNotFound: 3, TodoArchived: 70 } }],
];

describe("nothing exits but the edge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(calls)("%s ends with a code, never exits", async (_n, argv, setup) => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit was called");
    });
    const todos = makeTodos(setup);
    const memory = memoryIo({ argv, env });
    const result = await Effect.runPromise(
      (runner.run(todos.program, memory.io) as Effect.Effect<ExitCode>).pipe(Effect.exit),
    );
    expect(Exit.isSuccess(result)).toBe(true);
    expect(typeof (Exit.isSuccess(result) ? result.value : undefined)).toBe("number");
    expect(exit).not.toHaveBeenCalled();
  });
});
