// The runner tests' process, in memory (vendor tests/support/memory-io.ts, ported to Effect 3):
// each write to `out` and `err` kept apart, in order, and the reads of stdin and of files counted.
import { Effect } from "effect";
import { runner } from "../../../../../src/cli/commandLibrary/commander/index.js";
import type {
  ExitCode,
  Io,
  Program,
} from "../../../../../src/cli/commandLibrary/contract/index.js";

export interface MemoryIoOptions {
  readonly argv: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string;
  /** Stdin is a terminal whose read never ends: evaluating `io.stdin` is counted and dies. */
  readonly stdinIsTerminal?: boolean;
  /** The files that exist, by path, as text. */
  readonly files?: Readonly<Record<string, string>>;
  readonly columns?: number;
  readonly color?: boolean;
}

export interface MemoryIo {
  readonly io: Io;
  /** Each text written to `out`, in order. */
  readonly out: string[];
  /** Each text written to `err`, in order. */
  readonly err: string[];
  /** How many times `io.stdin` was evaluated. */
  readonly stdinReads: () => number;
  /** The paths read through `io.readFile`, in order. */
  readonly fileReads: () => ReadonlyArray<string>;
  /** The files written through `io.writeFile`, by path, as text. */
  readonly fileWrites: () => Readonly<Record<string, string>>;
}

/** The process as data, in memory: nothing is read from or written to the real one. */
export function memoryIo(options: MemoryIoOptions): MemoryIo {
  const out: string[] = [];
  const err: string[] = [];
  const fileReads: string[] = [];
  const files: Record<string, string> = { ...options.files };
  const writes: Record<string, string> = {};
  let reads = 0;
  const io: Io = {
    argv: options.argv,
    stdin: Effect.suspend(() => {
      reads += 1;
      return options.stdinIsTerminal === true
        ? Effect.die(new Error("stdin is a terminal: its read was awaited"))
        : Effect.succeed(options.stdin ?? "");
    }),
    stdinIsTerminal: options.stdinIsTerminal ?? false,
    readFile: (path) =>
      Effect.suspend(() => {
        fileReads.push(path);
        const text = files[path];
        return text === undefined
          ? Effect.fail("no such file or directory")
          : Effect.succeed(new TextEncoder().encode(text));
      }),
    writeFile: (path, bytes) =>
      Effect.sync(() => {
        const text = new TextDecoder().decode(bytes);
        files[path] = text;
        writes[path] = text;
      }),
    env: options.env ?? {},
    terminal: {
      columns: options.columns ?? 80,
      color: options.color ?? false,
    },
    out: (text) =>
      Effect.sync(() => {
        out.push(text);
      }),
    err: (text) =>
      Effect.sync(() => {
        err.push(text);
      }),
  };
  return {
    io,
    out,
    err,
    stdinReads: () => reads,
    fileReads: () => fileReads,
    fileWrites: () => writes,
  };
}

export interface Call {
  readonly code: ExitCode;
  readonly out: string[];
  readonly err: string[];
  readonly stdinReads: () => number;
  readonly fileReads: () => ReadonlyArray<string>;
  readonly fileWrites: () => Readonly<Record<string, string>>;
}

/** Runs a program against an in-memory `Io`. A program may ask for services (the samples' `Todos`)
 *  that the calls of a test never reach, so none is provided. */
export async function call<R>(program: Program<R>, options: MemoryIoOptions): Promise<Call> {
  const memory = memoryIo(options);
  const run = runner.run(program, memory.io) as Effect.Effect<ExitCode>;
  const code = await Effect.runPromise(run);
  return {
    code,
    out: memory.out,
    err: memory.err,
    stdinReads: memory.stdinReads,
    fileReads: memory.fileReads,
    fileWrites: memory.fileWrites,
  };
}
