// What the runner refuses, each case on the line after its `@ts-expect-error`: the compiler fails
// the check if the line compiles.
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

const exit = runner.run(program, processIo(process));

// a program whose services are not provided, run at the edge
// @ts-expect-error
process.exitCode = await Effect.runPromise(exit);

// processIo given the arguments instead of the process
// @ts-expect-error
processIo(process.argv);

// the runner given no Io
// @ts-expect-error
runner.run(program);

// the runner's Effect handed to the exit code without being run
// @ts-expect-error
process.exitCode = exit.pipe(Effect.provide(layer));
