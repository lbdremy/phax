import { Effect } from "effect";
import type { Io, Terminal } from "../../contracts/command.ts";
import { utf8Bytes, utf8Text } from "../written.ts";

export interface MemoryIoOptions {
  readonly argv: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string;
  /** Stdin is a terminal whose read never ends. Evaluating `io.stdin` is counted and dies, rather
   *  than waiting, so that a runner that reads a terminal is reported, not hung: the suite runs
   *  with `Effect.runSync` as well as `runPromise`. */
  readonly stdinIsTerminal?: boolean;
  /** The files that exist, by path, as text. */
  readonly files?: Readonly<Record<string, string>>;
  readonly terminal?: Terminal;
}

export interface MemoryIo {
  readonly io: Io;
  /** Everything written to `out`, in order. */
  readonly out: () => string;
  /** Everything written to `err`, in order. */
  readonly err: () => string;
  /** How many times `io.stdin` was evaluated. */
  readonly stdinReads: () => number;
  /** The paths read through `io.readFile`, in order. */
  readonly fileReads: () => ReadonlyArray<string>;
  /** The files written through `io.writeFile`, by path, as text. */
  readonly fileWrites: () => Readonly<Record<string, string>>;
}

/** The suite's `Io`, in memory: nothing is read from or written to a real terminal or disk. */
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
          : Effect.succeed(utf8Bytes(text));
      }),
    writeFile: (path, bytes) =>
      Effect.sync(() => {
        const text = utf8Text(bytes);
        files[path] = text;
        writes[path] = text;
      }),
    env: options.env ?? {},
    terminal: options.terminal ?? { columns: 80, color: false },
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
    out: () => out.join(""),
    err: () => err.join(""),
    stdinReads: () => reads,
    fileReads: () => fileReads,
    fileWrites: () => writes,
  };
}
