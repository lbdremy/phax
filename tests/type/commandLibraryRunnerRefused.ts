// The runner at the edge (vendor cli-command-commander edge.ts and refused.ts, ported to Effect 3):
// the whole example's edge, the program run against the process to its exit code, then what the
// runner refuses, each case on the line after its `@ts-expect-error`: the compiler fails the
// check if the line compiles. Each case stays on one line, out of the formatter's reach, so that
// the directive covers it whole. Compiled under `pnpm test:type`, and never loaded.
import { Effect, type Layer } from "effect";
import { processIo, runner } from "../../src/cli/commandLibrary/commander/index.js";
import { defineProgram } from "../../src/cli/commandLibrary/contract/index.js";
import { listTodos, renameTodo, type Todos } from "../unit/commandLibrary/support/renameTodo.js";

declare const layer: Layer.Layer<Todos>;

const program = defineProgram({
  name: "sandbox",
  version: "1.0.0",
  exits: { refused: 2, defect: 70 },
  commands: [renameTodo, listTodos],
});

// ---------------------------------------------------------------- edge.ts
// The program run against the process, its services provided, to its exit code.

process.exitCode = await Effect.runPromise(
  runner.run(program, processIo(process)).pipe(Effect.provide(layer)),
);

// ---------------------------------------------------------------- refused.ts

const exit = runner.run(program, processIo(process));

// a program whose services are not provided, run at the edge
// prettier-ignore
// @ts-expect-error
process.exitCode = await Effect.runPromise(exit);

// processIo given the arguments instead of the process
// prettier-ignore
// @ts-expect-error
processIo(process.argv);

// the runner given no Io
// prettier-ignore
// @ts-expect-error
runner.run(program);

// the runner's Effect handed to the exit code without being run
// prettier-ignore
// @ts-expect-error
process.exitCode = exit.pipe(Effect.provide(layer));
