import { Context, type Effect } from "effect";

export interface TerminalOps {
  /** Whether stdin is a terminal: a person may be at the keyboard, not a script. */
  readonly stdinIsTerminal: Effect.Effect<boolean>;
}

export class Terminal extends Context.Tag("phax/Terminal")<Terminal, TerminalOps>() {}
