import { Effect, Layer } from "effect";
import { Terminal } from "../ports/terminal.js";

// The same stream `phax prune` and `phax init` read to tell a person from a script.
export const NodeTerminalLayer: Layer.Layer<Terminal> = Layer.succeed(Terminal, {
  stdinIsTerminal: Effect.sync(() => Boolean(process.stdin.isTTY)),
});
