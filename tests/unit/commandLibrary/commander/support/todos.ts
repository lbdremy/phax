// The runner tests' `todos` program (vendor tests/support/todos.ts, ported to Effect 3): the
// samples' contracts and exits, with a `run` and a `render` of the tests' own.
import { Effect } from "effect";
import { vi, type Mock } from "vitest";
import {
  defineCommand,
  defineProgram,
  reject,
  strip,
  type Command,
  type Program,
  type Source,
} from "../../../../../src/cli/commandLibrary/contract/index.js";
import {
  RenameTodoArgs,
  RenameTodoFlags,
  TodoArchived,
  TodoNotFound,
  TodoView,
  TodosEnv,
} from "../../support/renameTodo.js";

/** What `rename-todo`'s run receives: each source, decoded. */
interface RenameInput {
  readonly args: typeof RenameTodoArgs.Type;
  readonly flags: typeof RenameTodoFlags.Type;
  readonly env: typeof TodosEnv.Type;
}

export type RenameValue = typeof TodoView.Type;
export type RenameRun = (
  input: RenameInput,
) => Effect.Effect<RenameValue, TodoNotFound | TodoArchived>;

export interface TodosOverrides {
  /** Replaces `rename-todo`'s run. */
  readonly run?: RenameRun;
  /** Replaces `rename-todo`'s render. */
  readonly render?: (value: RenameValue) => string;
  /** Replaces `rename-todo`'s output source. */
  readonly output?: Source<typeof TodoView>;
  /** Replaces `rename-todo`'s exit codes. */
  readonly exits?: {
    readonly TodoNotFound: number;
    readonly TodoArchived: number;
  };
  /** Replaces `list-todos`'s render. */
  readonly listRender?: (names: ReadonlyArray<string>) => string;
  /** Replaces the whole list of commands: the spies then stay unused. */
  readonly commands?: ReadonlyArray<Command<never>>;
}

export interface Todos {
  readonly program: Program<never>;
  /** The spy on `rename-todo`'s run. */
  readonly run: Mock<RenameRun>;
  /** The spy on `list-todos`'s run. */
  readonly listRun: Mock<() => Effect.Effect<ReadonlyArray<string>>>;
  /** How many runs, of any command, were called. */
  readonly runs: () => number;
}

const exits = { refused: 2, defect: 70 } as const;

/** A program named `todos`, as the samples' one is, from the commands it is given. */
export function programOf(commands: ReadonlyArray<Command<never>>): Program<never> {
  return defineProgram({ name: "todos", version: "1.0.0", exits, commands });
}

/** The tests' `todos`: the samples' contracts and exits, with a `run` and a `render` of the tests'
 *  own, so that a call can reach `rename-todo`'s run, which the samples' `rename` cannot. */
export function makeTodos(overrides: TodosOverrides = {}): Todos {
  const run = vi.fn<RenameRun>(
    overrides.run ??
      ((input) => {
        const todo = {
          id: input.args[0],
          name: input.flags.to,
          archived: false,
        };
        return Effect.succeed(todo);
      }),
  );
  const listRun = vi.fn(() => Effect.succeed(["a", "b"]));
  const renameTodo = defineCommand({
    name: "rename-todo",
    summary: "rename a todo",
    input: {
      args: reject(RenameTodoArgs),
      flags: reject(RenameTodoFlags),
      env: strip(TodosEnv),
    },
    output: overrides.output ?? strip(TodoView),
    exits: overrides.exits ?? { TodoNotFound: 3, TodoArchived: 4 },
    run: ({ input }) => run(input),
    render: overrides.render ?? ((todo) => `${todo.id} ${todo.name}`),
  });
  // A plain `Command`, not `defineCommand`: the types refuse a value answered without an output
  // contract, and these tests prove what the runner does with one that has none (render gets the
  // value itself).
  const listTodos: Command<never> = {
    name: "list-todos",
    summary: "list the todos",
    input: {},
    exits: {},
    run: () => listRun(),
    render: overrides.listRender ?? ((names: ReadonlyArray<string>) => names.join("\n")),
  };
  return {
    program: programOf(overrides.commands ?? [renameTodo, listTodos]),
    run,
    listRun,
    runs: () => run.mock.calls.length + listRun.mock.calls.length,
  };
}
