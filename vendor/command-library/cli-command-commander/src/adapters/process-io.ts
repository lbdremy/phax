import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import type { Io } from "@steme-lab/cli-command";

const readAll = async (stream: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/** Why a file operation failed, as a phrase: Node's `ENOENT: no such file or directory, open 'x'`
 *  as `no such file or directory`. */
const why = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^[A-Z0-9_]+: /, "").replace(/, [a-z]+ '.*'$/, "");
};

/** The process as the runner reads it: the arguments after the script, stdin read once when a
 *  command declares it, the environment, the terminal, stdout and stderr, and the files. */
export function processIo(process: NodeJS.Process): Io {
  const isTty = process.stdout.isTTY === true;
  const columns = process.stdout.columns;
  // Read once, on the first evaluation of `stdin`; every evaluation answers the same text.
  let stdin: Promise<string> | undefined;
  return {
    argv: process.argv.slice(2),
    stdin: Effect.promise(() => (stdin ??= readAll(process.stdin))),
    stdinIsTerminal: process.stdin.isTTY === true,
    readFile: (path) =>
      Effect.tryPromise({
        try: async (): Promise<Uint8Array> =>
          new Uint8Array(await readFile(path)),
        catch: why,
      }),
    writeFile: (path, bytes) =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, bytes);
        },
        catch: why,
      }),
    env: process.env,
    terminal: {
      columns: isTty && typeof columns === "number" ? columns : 80,
      color: isTty && process.env.NO_COLOR === undefined,
    },
    out: (text) =>
      Effect.sync(() => {
        process.stdout.write(text);
      }),
    err: (text) =>
      Effect.sync(() => {
        process.stderr.write(text);
      }),
  };
}
