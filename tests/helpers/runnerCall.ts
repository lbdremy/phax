// One call of a runner program built of the commands under test, over the memory Io of
// src/cli/commandLibrary/contract/conformance/memoryIo.ts: what it wrote on stdout and stderr, and
// the code it ended with. The commands come from their definition factories, given the fake
// layers of the test, so nothing reaches a real session, terminal or provider.
// oxlint-disable typescript/no-explicit-any -- a program of commands whatever services they ask for
import { Effect } from "effect";
import { runner } from "../../src/cli/commandLibrary/commander/index.js";
import { memoryIo } from "../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import {
  type Command,
  defineGroup,
  defineProgram,
  type ExitCode,
  type Group,
  type Program,
} from "../../src/cli/commandLibrary/contract/index.js";

export interface RunnerCallOptions {
  /** What a pipe on stdin holds. */
  readonly stdin?: string;
  /** Stdin is a terminal: the runner refuses to read it. */
  readonly stdinIsTerminal?: boolean;
  /** The files the runner may read (a stdin document named by path), by the path as typed. */
  readonly files?: Readonly<Record<string, string>>;
  /** The program's options, decoded wherever they stand in the call (phaxProgram's `--verbose`
   *  and `--trace`); none unless given. */
  readonly programOptions?: Program<unknown>["options"];
}

export interface RunnerCallResult {
  readonly code: ExitCode;
  /** Everything written on stdout. */
  readonly out: string;
  /** Everything written on stderr. */
  readonly err: string;
  /** Stdout's lines, without the empty one after the last newline. */
  readonly outLines: ReadonlyArray<string>;
  /** Stderr's lines, without the empty one after the last newline. */
  readonly errLines: ReadonlyArray<string>;
  /** Every write, in the order made: which stream, and what. */
  readonly writes: ReadonlyArray<{ readonly stream: "out" | "err"; readonly text: string }>;
  /** How many times stdin was read. */
  readonly stdinReads: number;
}

const linesOf = (text: string): ReadonlyArray<string> =>
  text === "" ? [] : text.replace(/\n$/, "").split("\n");

/** The `artifact` group holding `commands`, as phax's program places them. */
export function inArtifact(...commands: ReadonlyArray<Command<any> | Group<any>>): Group<any> {
  return defineGroup({
    name: "artifact",
    summary: "Inspect and transition the lifecycle status of a spec or plan",
    commands,
  });
}

/** The nested `artifact new` group holding `commands`. */
export function inArtifactNew(...commands: ReadonlyArray<Command<any> | Group<any>>): Group<any> {
  return inArtifact(defineGroup({ name: "new", summary: "Create a Draft spec or plan", commands }));
}

/** Runs `argv` against a program of `commands`, with phax's exit codes and refusal hint. */
export async function runnerCall(
  commands: ReadonlyArray<Command<any> | Group<any>>,
  argv: ReadonlyArray<string>,
  options: RunnerCallOptions = {},
): Promise<RunnerCallResult> {
  const { programOptions, ...io } = options;
  const program = defineProgram({
    name: "phax",
    version: "1.0.0",
    exits: { refused: 64, defect: 70 },
    refusalHint: "Run `phax --help` for usage.",
    commands,
    ...(programOptions === undefined ? {} : { options: programOptions }),
  });
  const memory = memoryIo({ argv, ...io });
  const code = await Effect.runPromise(runner.run(program, memory.io) as Effect.Effect<ExitCode>);
  const out = memory.out();
  const err = memory.err();
  return {
    code,
    out,
    err,
    outLines: linesOf(out),
    errLines: linesOf(err),
    writes: memory.writes(),
    stdinReads: memory.stdinReads(),
  };
}

/** A program without its guard: phax's phase guard reads the process's working directory, and
 *  the suite may run inside a phase worktree, where it would refuse the commands under test. The
 *  guard is proved on its own in tests/integration/phaseGuard.test.ts. */
export function withoutGuard<R>(program: Program<R>): Program<R> {
  const { guard: _guard, ...rest } = program;
  return rest;
}

/** Runs `argv` against phax's whole program, as `phax <argv>` does in a terminal, its phase guard
 *  set aside. The commands keep their real adapters, so a test swaps what they reach with
 *  `vi.mock` or a fixture on disk, and the working directory is the process's. */
export async function phaxCall(
  argv: ReadonlyArray<string>,
  options: Omit<RunnerCallOptions, "programOptions"> = {},
): Promise<RunnerCallResult> {
  const { phaxProgram } = await import("../../src/cli/definitions/program.js");
  const memory = memoryIo({ argv, ...options });
  const code = await Effect.runPromise(
    runner.run(withoutGuard(phaxProgram), memory.io) as Effect.Effect<ExitCode>,
  );
  const out = memory.out();
  const err = memory.err();
  return {
    code,
    out,
    err,
    outLines: linesOf(out),
    errLines: linesOf(err),
    writes: memory.writes(),
    stdinReads: memory.stdinReads(),
  };
}
