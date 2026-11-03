// What the contract refuses (vendor refused.ts, ported to Effect 3, and the gains'), each case on
// the line after its `@ts-expect-error`: the compiler fails the check if the line compiles. Each
// case stays on one line, out of the formatter's reach, so that the directive covers it whole.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import {
  defineCommand,
  defineProgram,
  reject,
  strip,
  type Io,
  type Runner,
} from "../../src/cli/commandLibrary/contract/index.js";
import {
  RenameTodoArgs,
  RenameTodoFlags,
  TodoView,
  rename,
  renameTodo,
} from "../unit/commandLibrary/support/renameTodo.js";

const fails = rename("1", "a", "db");

// an error run may fail with, and no exit code for it
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "a", summary: "", input: {}, exits: { TodoNotFound: 3 }, run: () => fails, render: (t) => t.name });

// an exit code for an error run never fails with
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "b", summary: "", input: {}, exits: { TodoNotFound: 3, TodoArchived: 4, Gone: 5 }, run: () => fails, render: (t) => t.name });

// run reads an option the contract does not declare
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "c", summary: "", input: { flags: reject(RenameTodoFlags) }, exits: {}, run: ({ input }) => Effect.succeed(input.flags.force), render: String });

// a source without its policy
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "h", summary: "", input: { flags: RenameTodoFlags }, exits: {}, run: () => Effect.succeed(1), render: String });

// an output without its policy
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "i", summary: "", input: {}, output: TodoView, exits: { TodoNotFound: 3, TodoArchived: 4 }, run: () => fails, render: (t) => t.name });

// run succeeds with a record and the command declares no output
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "j", summary: "", input: {}, exits: {}, run: () => Effect.succeed({ id: "1" }), render: (t) => t.id });

// run succeeds with a record, no output and no render
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "k", summary: "", input: {}, exits: {}, run: () => Effect.succeed({ id: "1" }) });

// a command that succeeds with nothing needs no output, and no render
export const answersNothing = defineCommand({
  name: "l",
  summary: "",
  input: {},
  exits: {},
  run: () => Effect.void,
});

// a command with an output and no render
// prettier-ignore
export const answersEncoded = defineCommand({ name: "m", summary: "", input: {}, output: strip(TodoView), exits: {}, run: () => Effect.succeed({ id: "1", name: "a" }) });

// the positional arguments given as a struct
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "d", summary: "", input: { args: reject(RenameTodoFlags) }, exits: {}, run: () => Effect.succeed(1), render: String });

// the options given as a tuple
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "e", summary: "", input: { flags: reject(RenameTodoArgs) }, exits: {}, run: () => Effect.succeed(1), render: String });

// render reads what the output contract drops
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "f", summary: "", input: {}, output: strip(TodoView), exits: { TodoNotFound: 3, TodoArchived: 4 }, run: () => fails, render: (t) => String(t.archived) });

// run succeeds with what the output contract cannot hold
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "g", summary: "", input: {}, output: strip(TodoView), exits: {}, run: () => Effect.succeed({ id: 1 }), render: (t) => t.name });

// Gain (a declared error's text form): a text for an error run never fails with
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "n", summary: "", input: {}, output: strip(TodoView), exits: { TodoNotFound: 3, TodoArchived: 4 }, texts: { Gone: () => "gone" }, run: () => fails });

// Gain (a declared error's text form): a text reading a field its error does not carry
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "o", summary: "", input: {}, output: strip(TodoView), exits: { TodoNotFound: 3, TodoArchived: 4 }, texts: { TodoNotFound: (error) => error.reason }, run: () => fails });

// Gain (verdict codes): a verdict reading what the output contract drops
// prettier-ignore
// @ts-expect-error
defineCommand({ name: "p", summary: "", input: {}, output: strip(TodoView), exits: { TodoNotFound: 3, TodoArchived: 4 }, verdicts: { 1: (t) => t.archived }, run: () => fails });

declare const runner: Runner;
declare const io: Io;
// prettier-ignore
const program = defineProgram({ name: "todos", version: "1.0.0", exits: { refused: 2, defect: 70 }, commands: [renameTodo] });

// a program that does not say which codes its runner exits with
// prettier-ignore
// @ts-expect-error
defineProgram({ name: "todos", version: "1.0.0", commands: [renameTodo] });

// a program whose services are not provided, run as if it needed none
// prettier-ignore
// @ts-expect-error
export const unprovided: Effect.Effect<number, never, never> = runner.run(program, io);

// Gain (the program's usage flag): a place for --json-schema the usage spec does not know
// prettier-ignore
// @ts-expect-error
defineProgram({ name: "todos", version: "1.0.0", exits: { refused: 2, defect: 70 }, usage: { flag: "usage", jsonSchema: "nowhere" }, commands: [renameTodo] });

// Gain (options for every command): program options given as a tuple
// prettier-ignore
// @ts-expect-error
defineProgram({ name: "todos", version: "1.0.0", exits: { refused: 2, defect: 70 }, options: reject(RenameTodoArgs), commands: [renameTodo] });

export const used = Schema.String;
