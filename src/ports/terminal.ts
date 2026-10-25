import { Context, Data, type Effect } from "effect";

/** Standard input could not be read to its end. */
export class StdinReadError extends Data.TaggedError("StdinReadError")<{
  message: string;
  cause?: unknown;
}> {}

export interface TerminalOps {
  /** Whether stdin is a terminal: a person may be at the keyboard, not a script. */
  readonly stdinIsTerminal: Effect.Effect<boolean>;
  /** Standard input read to its end, as UTF-8 text. */
  readonly readStdin: Effect.Effect<string, StdinReadError>;
}

export class Terminal extends Context.Tag("phax/Terminal")<Terminal, TerminalOps>() {}
