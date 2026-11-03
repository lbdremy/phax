// What the contract refuses, each case on the line after its `@ts-expect-error`: the compiler fails
// the check if the line compiles.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { defineCommand, defineProgram, reject, strip, type Io, type Runner } from "@steme-lab/cli-command";
import { RenameTodoArgs, RenameTodoFlags, TodoView, rename, renameTodo } from "./rename-todo.command.ts";

const fails = rename("1", "a", "db");

// an error run may fail with, and no exit code for it
// @ts-expect-error
defineCommand({ name: "a", summary: "", input: {}, exits: { TodoNotFound: 3 }, run: () => fails, render: (t) => t.name });

// an exit code for an error run never fails with
// @ts-expect-error
defineCommand({ name: "b", summary: "", input: {}, exits: { TodoNotFound: 3, TodoArchived: 4, Gone: 5 }, run: () => fails, render: (t) => t.name });

// run reads an option the contract does not declare
// @ts-expect-error
defineCommand({ name: "c", summary: "", input: { flags: reject(RenameTodoFlags) }, exits: {}, run: ({ input }) => Effect.succeed(input.flags.force), render: String });

// a source without its policy
// @ts-expect-error
defineCommand({ name: "h", summary: "", input: { flags: RenameTodoFlags }, exits: {}, run: () => Effect.succeed(1), render: String });

// an output without its policy
// @ts-expect-error
defineCommand({ name: "i", summary: "", input: {}, output: TodoView, exits: { TodoNotFound: 3, TodoArchived: 4 }, run: () => fails, render: (t) => t.name });

// run succeeds with a record and the command declares no output
// @ts-expect-error
defineCommand({ name: "j", summary: "", input: {}, exits: {}, run: () => Effect.succeed({ id: "1" }), render: (t) => t.id });

// run succeeds with a record, no output and no render
// @ts-expect-error
defineCommand({ name: "k", summary: "", input: {}, exits: {}, run: () => Effect.succeed({ id: "1" }) });

// a command that succeeds with nothing needs no output, and no render
export const answersNothing = defineCommand({ name: "l", summary: "", input: {}, exits: {}, run: () => Effect.void });

// a command with an output and no render
export const answersEncoded = defineCommand({ name: "m", summary: "", input: {}, output: strip(TodoView), exits: {}, run: () => Effect.succeed({ id: "1", name: "a" }) });

// the positional arguments given as a struct
// @ts-expect-error
defineCommand({ name: "d", summary: "", input: { args: reject(RenameTodoFlags) }, exits: {}, run: () => Effect.succeed(1), render: String });

// the options given as a tuple
// @ts-expect-error
defineCommand({ name: "e", summary: "", input: { flags: reject(RenameTodoArgs) }, exits: {}, run: () => Effect.succeed(1), render: String });

// render reads what the output contract drops
// @ts-expect-error
defineCommand({ name: "f", summary: "", input: {}, output: strip(TodoView), exits: { TodoNotFound: 3, TodoArchived: 4 }, run: () => fails, render: (t) => String(t.archived) });

// run succeeds with what the output contract cannot hold
// @ts-expect-error
defineCommand({ name: "g", summary: "", input: {}, output: strip(TodoView), exits: {}, run: () => Effect.succeed({ id: 1 }), render: (t) => t.name });

declare const runner: Runner;
declare const io: Io;
const program = defineProgram({ name: "todos", version: "1.0.0", exits: { refused: 2, defect: 70 }, commands: [renameTodo] });

// a program that does not say which codes its runner exits with
// @ts-expect-error
defineProgram({ name: "todos", version: "1.0.0", commands: [renameTodo] });

// a program whose services are not provided, run as if it needed none
// @ts-expect-error
export const unprovided: Effect.Effect<number, never, never> = runner.run(program, io);

export const used = Schema.String;
