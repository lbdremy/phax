// The command library's samples (vendor rename-todo.command.ts and program.ts), ported to
// Effect 3, and the gains' declarations: they compile under `pnpm test:type`, and nothing loads
// them at run time.
import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import {
  CompleterAnnotationId,
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
  type Io,
  type Runner,
} from "../../src/cli/commandLibrary/contract/index.js";

// ---------------------------------------------------------------- rename-todo.command.ts
// A command as the contract has it: its sources decoded, its output reduced, an exit per error.

export const RenameTodoArgs = Schema.Tuple(Schema.String);
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

// ---------------------------------------------------------------- program.ts
// A program, and a runner run at the edge: the services the commands need are what it asks for.

export const program = defineProgram({
  name: "todos",
  version: "1.0.0",
  exits: { refused: 2, defect: 70 },
  commands: [renameTodo, listTodos],
});

declare const runner: Runner;
declare const io: Io;
export const exit: Effect.Effect<number, never, Todos> = runner.run(program, io);

// ---------------------------------------------------------------- the gains

/** An argument naming a run, with its completer. */
const ShortName = Schema.String.annotations({
  identifier: "short-name",
  description: "The run's short name",
  [CompleterAnnotationId]: { run: "todos ls --complete", descriptions: true },
});

const Report = Schema.Struct({ errors: Schema.Number });

/** Verdict codes, a declared error's text form, progress, a required stdin-flag value and the
 *  program's options, read in run. */
export const lintTodo = defineCommand({
  name: "lint",
  summary: "lint a todo",
  input: {
    args: reject(Schema.Tuple(ShortName)),
    stdin: reject(Schema.Struct({ rules: Schema.Array(Schema.String) }), {
      flag: "rules",
      required: true,
      valueRequired: true,
    }),
  },
  output: strip(Report),
  exits: { TodoNotFound: 3 },
  verdicts: { 1: (report) => report.errors > 0 },
  // `texts` follows a `run` that reads its context: the errors are inferred from `run`, in the
  // order the definition's keys are written.
  run: ({ input, progress, program: options }) =>
    Effect.gen(function* () {
      yield* progress(`linting ${input.args[0]} against ${input.stdin.rules.length} rules`);
      if (options["verbose"] === true) yield* progress("verbose");
      if (input.args[0] === "") return yield* new TodoNotFound({ id: "" });
      return { errors: 0 };
    }),
  texts: { TodoNotFound: (error) => `no todo named ${error.id}` },
  render: (report) => `${report.errors} errors`,
});

/** A text stdin document, optional behind its flag. */
export const briefTodo = defineCommand({
  name: "brief",
  summary: "brief a todo",
  input: { stdin: strip(Schema.String, { flag: "brief", text: true }) },
  output: strip(Schema.String),
  exits: {},
  run: ({ input }) => Effect.succeed(input.stdin ?? "no brief"),
});

/** Groups holding groups, the program's usage flag and its options. */
export const gained = defineProgram({
  name: "todos",
  version: "1.0.0",
  exits: { refused: 64, defect: 70 },
  usage: { flag: "usage", format: "usage-format", jsonSchema: "program" },
  options: reject(Schema.Struct({ verbose: Schema.optionalWith(Schema.Boolean, { exact: true }) })),
  commands: [
    renameTodo,
    defineGroup({
      name: "todo",
      summary: "Todos",
      commands: [
        lintTodo,
        defineGroup({ name: "brief", summary: "Briefs", commands: [briefTodo] }),
      ],
    }),
  ],
});

export const gainedExit: Effect.Effect<number, never, Todos> = runner.run(gained, io);
