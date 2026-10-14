import { Effect, Layer } from "effect";
import { Terminal, type TerminalOps } from "../../ports/terminal.js";

export class FakeTerminalImpl implements TerminalOps {
  readonly stdinIsTerminal: Effect.Effect<boolean>;

  constructor(isTerminal: boolean) {
    this.stdinIsTerminal = Effect.succeed(isTerminal);
  }
}

/** A Terminal whose stdin is, or is not, a terminal, for the whole test. */
export const makeFakeTerminal = (isTerminal: boolean) => {
  const impl = new FakeTerminalImpl(isTerminal);
  const layer = Layer.succeed(Terminal, impl);
  return { impl, layer } as const;
};
