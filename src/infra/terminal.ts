import { Effect, Layer } from "effect";
import { StdinReadError, Terminal } from "../ports/terminal.js";

// The stream `phax prune` and `phax init` read to tell a person from a script,
// and the one `--verdicts -` is read from. A stream is read once.
export const makeNodeTerminalLayer = (
  stream: NodeJS.ReadableStream & { readonly isTTY?: boolean } = process.stdin,
): Layer.Layer<Terminal> =>
  Layer.succeed(Terminal, {
    stdinIsTerminal: Effect.sync(() => Boolean(stream.isTTY)),
    readStdin: Effect.tryPromise({
      try: async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
        }
        return Buffer.concat(chunks).toString("utf8");
      },
      catch: (cause) =>
        new StdinReadError({
          message: `failed to read stdin: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    }),
  });

export const NodeTerminalLayer: Layer.Layer<Terminal> = makeNodeTerminalLayer();
