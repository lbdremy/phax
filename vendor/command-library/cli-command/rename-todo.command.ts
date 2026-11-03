// A command as the contract has it: its sources decoded, its output reduced, an exit per error.
import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import { defineCommand, reject, strip } from "@steme-lab/cli-command";

export const RenameTodoArgs = Schema.Tuple([Schema.String]);
export const RenameTodoFlags = Schema.Struct({
  to: Schema.String,
  dryRun: Schema.optional(Schema.Boolean),
});
export const TodosEnv = Schema.Struct({ TODOS_DB: Schema.String });
export const TodoView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
  readonly id: string;
}> {}
export class TodoArchived extends Data.TaggedError("TodoArchived")<{
  readonly id: string;
}> {}
export interface Todos {
  readonly _: "Todos";
}
export interface Todo {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}
export declare const rename: (
  id: string,
  to: string,
  db: string,
) => Effect.Effect<Todo, TodoNotFound | TodoArchived, Todos>;

export const renameTodo = defineCommand({
  name: "rename-todo",
  summary: "rename a todo",
  input: {
    args: reject(RenameTodoArgs),
    flags: reject(RenameTodoFlags),
    env: strip(TodosEnv),
  },
  output: strip(TodoView),
  exits: { TodoNotFound: 3, TodoArchived: 4 },
  run: ({ input }) => rename(input.args[0], input.flags.to, input.env.TODOS_DB),
  render: (todo) => `${todo.id} ${todo.name}`,
});

export const listTodos = defineCommand({
  name: "list-todos",
  summary: "list the todos",
  input: {},
  output: strip(Schema.Array(Schema.String)),
  exits: {},
  run: () => Effect.succeed(["a", "b"]),
  render: (names) => names.join("\n"),
});
