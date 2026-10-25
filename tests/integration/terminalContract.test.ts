import { Effect, Either, type Layer } from "effect";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { makeNodeTerminalLayer } from "../../src/infra/terminal.js";
import { StdinReadError, Terminal } from "../../src/ports/terminal.js";

// One suite, two adapters: the fake a use-case test feeds stdin to and the
// real one reading a stream must read and probe the terminal alike.

interface Subject {
  readonly name: string;
  /** A Terminal whose stdin holds `text` and is, or is not, a terminal. */
  readonly make: (text: string, isTerminal: boolean) => Layer.Layer<Terminal>;
}

function streamOf(text: string, isTerminal: boolean): Readable & { isTTY?: boolean } {
  const stream: Readable & { isTTY?: boolean } = Readable.from([text]);
  if (isTerminal) stream.isTTY = true;
  return stream;
}

const SUBJECTS: readonly Subject[] = [
  { name: "the fake", make: (text, isTerminal) => makeFakeTerminal(isTerminal, text).layer },
  {
    name: "the node adapter",
    make: (text, isTerminal) => makeNodeTerminalLayer(streamOf(text, isTerminal)),
  },
];

const readStdin = (layer: Layer.Layer<Terminal>) =>
  Effect.runPromise(
    Effect.either(Effect.flatMap(Terminal, (terminal) => terminal.readStdin)).pipe(
      Effect.provide(layer),
    ),
  );

const stdinIsTerminal = (layer: Layer.Layer<Terminal>) =>
  Effect.runPromise(
    Effect.flatMap(Terminal, (terminal) => terminal.stdinIsTerminal).pipe(Effect.provide(layer)),
  );

describe.each(SUBJECTS)("Terminal contract — $name", ({ make }) => {
  it("reads stdin's text to its end", async () => {
    const text = '{"verdicts":[{"question":"Q1","chosen":"Q1-a","note":"é — ü"}]}\n';
    expect(await readStdin(make(text, false))).toEqual(Either.right(text));
  });

  it("reads empty input as an empty string", async () => {
    expect(await readStdin(make("", false))).toEqual(Either.right(""));
  });

  it("says whether stdin is a terminal", async () => {
    expect(await stdinIsTerminal(make("", true))).toBe(true);
    expect(await stdinIsTerminal(make("", false))).toBe(false);
  });
});

describe("Terminal contract — a stdin that cannot be read", () => {
  it("fails the fake, given no stdin, with a StdinReadError", async () => {
    const result = await readStdin(makeFakeTerminal(false).layer);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(StdinReadError);
  });

  it("fails the node adapter, on a stream that errors, with a StdinReadError naming stdin", async () => {
    const broken = new Readable({
      read() {
        this.destroy(new Error("boom"));
      },
    });
    const result = await readStdin(makeNodeTerminalLayer(broken));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(StdinReadError);
      expect(result.left.message).toContain("failed to read stdin");
      expect(result.left.message).toContain("boom");
    }
  });
});
