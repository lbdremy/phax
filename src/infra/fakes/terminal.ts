import { Effect, Layer } from "effect";
import { StdinReadError, Terminal, type TerminalOps } from "../../ports/terminal.js";

export class FakeTerminalImpl implements TerminalOps {
  readonly stdinIsTerminal: Effect.Effect<boolean>;
  readonly readStdin: Effect.Effect<string, StdinReadError>;

  constructor(isTerminal: boolean, stdin?: string) {
    this.stdinIsTerminal = Effect.succeed(isTerminal);
    this.readStdin =
      stdin === undefined
        ? Effect.fail(new StdinReadError({ message: "failed to read stdin: no stdin was given" }))
        : Effect.succeed(stdin);
  }
}

/**
 * A Terminal whose stdin is, or is not, a terminal, for the whole test, and
 * that reads `stdin` as its text; with none given, reading it fails.
 */
export const makeFakeTerminal = (isTerminal: boolean, stdin?: string) => {
  const impl = new FakeTerminalImpl(isTerminal, stdin);
  const layer = Layer.succeed(Terminal, impl);
  return { impl, layer } as const;
};
