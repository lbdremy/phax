import { Effect, Option } from "effect";
import type * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type { Io, Source } from "../contract/index.js";
import { END_OF_OPTIONS, isOption } from "./undeclared.js";

/** How a call asks for the document of a stdin read bound to a flag. */
export type Reading =
  | { readonly tag: "Absent" }
  | { readonly tag: "Stdin" }
  | { readonly tag: "File"; readonly path: string }
  /** `--flag=` with nothing attached. */
  | { readonly tag: "Unpathed" }
  /** Gain (a required stdin-flag value): the flag alone, its value neither spaced nor attached. */
  | { readonly tag: "Unvalued" };

/** The document as read: the text, and what to call it in a refusal (`stdin`, or the path). */
export interface Document {
  readonly label: string;
  readonly text: string;
}

const readingOf = (value: string): Reading =>
  value === "-"
    ? { tag: "Stdin" }
    : value === ""
      ? { tag: "Unpathed" }
      : { tag: "File", path: value };

/** The words with the bound flag taken out, and how the flag was given. `--flag`, `--flag -` and
 *  `--flag=-` read stdin; `--flag=<path>` reads that file; a path is always attached, so a word
 *  after a bare flag that is not `-` stays an ordinary word. Nothing after `--` is read.
 *
 *  Gain carried for upstream (a required stdin-flag value): with `valueRequired`, the flag takes
 *  `<file|->` spaced or attached — `--flag <path>`, `--flag -`, `--flag=<path>`, `--flag=-` — and
 *  the flag alone, or followed by an option, is `Unvalued`. */
export function takeFlag(
  words: ReadonlyArray<string>,
  flag: string,
  valueRequired = false,
): { readonly kept: ReadonlyArray<string>; readonly reading: Reading } {
  const bare = `--${flag}`;
  const attached = `${bare}=`;
  const kept: string[] = [];
  let reading: Reading = { tag: "Absent" };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === END_OF_OPTIONS) {
      kept.push(...words.slice(index));
      break;
    }
    if (word === bare) {
      const next = words[index + 1];
      if (valueRequired) {
        if (next === undefined || (isOption(next) && next !== "-")) {
          reading = { tag: "Unvalued" };
        } else {
          reading = readingOf(next);
          index += 1;
        }
      } else {
        reading = { tag: "Stdin" };
        if (next === "-") index += 1;
      }
    } else if (word.startsWith(attached)) {
      reading = readingOf(word.slice(attached.length));
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

/** The identifier a contract declares: on its node, else on the side a refinement or a
 *  transformation stands on. */
function identifierOf(ast: SchemaAST.AST): string | undefined {
  const own = Option.getOrUndefined(SchemaAST.getIdentifierAnnotation(ast));
  if (own !== undefined) return own;
  if (SchemaAST.isRefinement(ast)) return identifierOf(ast.from);
  if (SchemaAST.isTransformation(ast)) return identifierOf(ast.to) ?? identifierOf(ast.from);
  return undefined;
}

/** The format a document is called in a refusal: its contract's identifier, else its title, else
 *  JSON. A text document (gain) is called by its identifier, else `text`: Effect 3 titles its
 *  keywords and refinements itself (`string`, `minLength(1)`), which no one wrote. */
function formatName(contract: Schema.Schema.Any, text = false): string {
  const identifier = identifierOf(contract.ast);
  if (identifier !== undefined) return identifier;
  if (text) return "text";
  return Option.getOrUndefined(SchemaAST.getTitleAnnotation(contract.ast)) ?? "JSON";
}

const line = (text: string): string => `${text}\n`;

const failure = (text: string, path: ReadonlyArray<string>, expected: string): ReadFailure => ({
  text: line(text),
  path,
  expected,
});

/** Reads the document of a command's stdin read, or says why the call is refused: what `err`
 *  receives. Answers `undefined` when the read is bound to a flag, not required, and the flag is
 *  absent. A terminal is refused without being read, a file never opens stdin. */
export function readDocument(
  io: Io,
  command: string,
  source: Source<Schema.Schema.Any>,
  reading: Reading,
): Effect.Effect<Document | undefined, ReadFailure> {
  const flag = source.flag;
  const text = source.text === true;
  const name = formatName(source.contract, text);
  const where = flag === undefined ? [] : [`--${flag}`];
  const valued = source.valueRequired === true;
  const given = valued ? `--${flag} <file>` : `--${flag}=<path>`;
  if (flag === undefined || reading.tag === "Stdin") {
    if (io.stdinIsTerminal) {
      return Effect.fail(
        failure(
          flag === undefined
            ? `error: ${command} reads a document of format ${name} on stdin, and stdin is a terminal: pipe it in`
            : `error: ${command} --${flag} reads a ${name} on stdin, and stdin is a terminal: pipe it in, or give ${given}`,
          where,
          `a ${name} piped in`,
        ),
      );
    }
    return io.stdin.pipe(Effect.map((read) => ({ label: "stdin", text: read })));
  }
  switch (reading.tag) {
    case "Absent":
      return source.required === true
        ? Effect.fail(
            failure(
              valued
                ? `error: ${command} requires --${flag} <file|->: give the file, or - to pipe a ${name} in`
                : `error: ${command} requires --${flag}: pipe a ${name} in with --${flag}, or give --${flag}=<path>`,
              where,
              valued
                ? `a ${name}, from a file or piped in with --${flag} -`
                : `a ${name}, piped in or attached as --${flag}=<path>`,
            ),
          )
        : Effect.succeed(undefined);
    case "Unvalued":
      return Effect.fail(
        failure(
          `error: --${flag} is given no value: give --${flag} <file|->`,
          where,
          `a path, or - for stdin, after --${flag}`,
        ),
      );
    case "Unpathed":
      return Effect.fail(
        failure(
          `error: --${flag}= is given no path: give ${given}`,
          where,
          `a path after --${flag}=`,
        ),
      );
    case "File": {
      const path = reading.path;
      return io.readFile(path).pipe(
        Effect.mapError((why) => failure(`error: ${path}: ${why}`, where, "a readable file")),
        Effect.flatMap((bytes) =>
          Effect.try({
            try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            catch: () =>
              failure(`error: ${path} is not ${text ? "UTF-8 text" : "JSON"}`, where, "UTF-8 text"),
          }),
        ),
        Effect.map((read) => ({ label: path, text: read })),
      );
    }
  }
}
