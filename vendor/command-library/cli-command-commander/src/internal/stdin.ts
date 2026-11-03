import { Effect } from "effect";
import type * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { Io, Source } from "@steme-lab/cli-command";
import { END_OF_OPTIONS } from "./undeclared.ts";

/** How a call asks for the document of a stdin read bound to a flag. */
export type Reading =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Stdin" }
  | { readonly _tag: "File"; readonly path: string }
  /** `--flag=` with nothing attached. */
  | { readonly _tag: "Unpathed" };

/** The document as read: the text, and what to call it in a refusal (`stdin`, or the path). */
export interface Document {
  readonly label: string;
  readonly text: string;
}

/** The words with the bound flag taken out, and how the flag was given. `--flag`, `--flag -` and
 *  `--flag=-` read stdin; `--flag=<path>` reads that file; a path is always attached, so a word
 *  after a bare flag that is not `-` stays an ordinary word. Nothing after `--` is read. */
export function takeFlag(
  words: ReadonlyArray<string>,
  flag: string,
): { readonly kept: ReadonlyArray<string>; readonly reading: Reading } {
  const bare = `--${flag}`;
  const attached = `${bare}=`;
  const kept: string[] = [];
  let reading: Reading = { _tag: "Absent" };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === END_OF_OPTIONS) {
      kept.push(...words.slice(index));
      break;
    }
    if (word === bare) {
      reading = { _tag: "Stdin" };
      if (words[index + 1] === "-") index += 1;
    } else if (word.startsWith(attached)) {
      const value = word.slice(attached.length);
      reading =
        value === "-"
          ? { _tag: "Stdin" }
          : value === ""
            ? { _tag: "Unpathed" }
            : { _tag: "File", path: value };
    } else {
      kept.push(word);
    }
  }
  return { kept, reading };
}

/** Why a document could not be read: the text for `err`, and what the `refused` line says. */
export interface ReadFailure {
  readonly text: string;
  /** The flag, as written, when the read is bound to one; else nothing. */
  readonly path: ReadonlyArray<string>;
  readonly expected: string;
}

/** The format a document is called in a refusal: its contract's identifier, else its title, else JSON. */
export function formatName(contract: Schema.Top): string {
  return (
    SchemaAST.resolveIdentifier(contract.ast) ??
    SchemaAST.resolveTitle(contract.ast) ??
    "JSON"
  );
}

const line = (text: string): string => `${text}\n`;

const failure = (
  text: string,
  path: ReadonlyArray<string>,
  expected: string,
): ReadFailure => ({ text: line(text), path, expected });

/** Reads the document of a command's stdin read, or says why the call is refused: what `err`
 *  receives. Answers `undefined` when the read is bound to a flag, not required, and the flag is
 *  absent. A terminal is refused without being read, a file never opens stdin. */
export function readDocument(
  io: Io,
  command: string,
  source: Source<Schema.Top>,
  reading: Reading,
): Effect.Effect<Document | undefined, ReadFailure> {
  const flag = source.flag;
  const name = formatName(source.contract);
  const where = flag === undefined ? [] : [`--${flag}`];
  if (flag === undefined || reading._tag === "Stdin") {
    if (io.stdinIsTerminal) {
      return Effect.fail(
        failure(
          flag === undefined
            ? `error: ${command} reads a document of format ${name} on stdin, and stdin is a terminal: pipe it in`
            : `error: ${command} --${flag} reads a ${name} on stdin, and stdin is a terminal: pipe it in, or give --${flag}=<path>`,
          where,
          `a ${name} piped in`,
        ),
      );
    }
    return io.stdin.pipe(Effect.map((text) => ({ label: "stdin", text })));
  }
  switch (reading._tag) {
    case "Absent":
      return source.required === true
        ? Effect.fail(
            failure(
              `error: ${command} requires --${flag}: pipe a ${name} in with --${flag}, or give --${flag}=<path>`,
              where,
              `a ${name}, piped in or attached as --${flag}=<path>`,
            ),
          )
        : Effect.succeed(undefined);
    case "Unpathed":
      return Effect.fail(
        failure(
          `error: --${flag}= is given no path: give --${flag}=<path>`,
          where,
          `a path after --${flag}=`,
        ),
      );
    case "File": {
      const path = reading.path;
      return io.readFile(path).pipe(
        Effect.mapError((why) =>
          failure(`error: ${path}: ${why}`, where, "a readable file"),
        ),
        Effect.flatMap((bytes) =>
          Effect.try({
            try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            catch: () =>
              failure(`error: ${path} is not JSON`, where, "UTF-8 text"),
          }),
        ),
        Effect.map((text) => ({ label: path, text })),
      );
    }
  }
}
