// A program, and a runner run at the edge: the services the commands need are what it asks for.
import type { Effect } from "effect";
import { defineProgram, type Io, type Runner } from "@steme-lab/cli-command";
import { listTodos, renameTodo, type Todos } from "./rename-todo.command.ts";

export const program = defineProgram({
  name: "todos",
  version: "1.0.0",
  exits: { refused: 2, defect: 70 },
  commands: [renameTodo, listTodos],
});

declare const runner: Runner;
declare const io: Io;
export const exit: Effect.Effect<number, never, Todos> = runner.run(
  program,
  io,
);
