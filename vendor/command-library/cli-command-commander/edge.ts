// The whole example's edge, replayed: the program run against the process, to its exit code.
// Compiled and never loaded.
import { Effect, type Layer } from "effect";
import { defineProgram } from "@steme-lab/cli-command";
import { processIo, runner } from "@steme-lab/cli-command-commander";
import {
  listTodos,
  renameTodo,
  type Todos,
} from "../cli-command/rename-todo.command.ts";

declare const layer: Layer.Layer<Todos>;

const program = defineProgram({
  name: "sandbox",
  version: "1.0.0",
  exits: { refused: 2, defect: 70 },
  commands: [renameTodo, listTodos],
});

process.exitCode = await Effect.runPromise(
  runner.run(program, processIo(process)).pipe(Effect.provide(layer)),
);
