import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import {
  messages,
  Written,
  type ExitCode,
  type RefusalSource,
} from "@steme-lab/cli-command";
import type { Outcome } from "./outcome.ts";
import { END_OF_OPTIONS, isOption } from "./undeclared.ts";

/** The option that answers in JSON, and the one that prints the contracts. */
export const JSON_OPTION = "--json";
export const JSON_SCHEMA_OPTION = "--json-schema";
/** The hidden option of the program that prints its usage spec. */
export const USAGE_SPEC_OPTION = "--usage-spec";
/** The option a command that writes a document is given by the runner. */
export const OUT_OPTION = "--out";

/** The two options the runner owns on every command, by their names without dashes. */
export const RESERVED: ReadonlyArray<string> = ["json", "json-schema"];

/** The words with the runner's two options taken out, and whether each was given. Nothing after
 *  `--` is read: a word there is a positional argument. */
export function takeReserved(words: ReadonlyArray<string>): {
  readonly kept: ReadonlyArray<string>;
  readonly json: boolean;
  readonly schema: boolean;
} {
  const kept: string[] = [];
  let json = false;
  let schema = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === END_OF_OPTIONS) {
      kept.push(...words.slice(index));
      break;
    }
    if (word === JSON_OPTION) json = true;
    else if (word === JSON_SCHEMA_OPTION) schema = true;
    else kept.push(word);
  }
  return { kept, json, schema };
}

/** How a call asks for `--out`. */
export type Out =
  | { readonly _tag: "Absent" }
  /** `--out -`: the document on stdout. */
  | { readonly _tag: "Dash" }
  | { readonly _tag: "Path"; readonly path: string }
  /** `--out` with nothing to write to: the last word, or followed by an option. */
  | { readonly _tag: "Missing"; readonly word: string };

/** The words with `--out` and its value taken out. `--out <path>` and `--out=<path>` name the
 *  file, `-` the standard output; a word after a bare `--out` that is an option (other than `-`)
 *  is not its value. Nothing after `--` is read. */
export function takeOut(words: ReadonlyArray<string>): {
  readonly kept: ReadonlyArray<string>;
  readonly out: Out;
} {
  const kept: string[] = [];
  let out: Out = { _tag: "Absent" };
  const given = (value: string): Out =>
    value === "-" ? { _tag: "Dash" } : { _tag: "Path", path: value };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === END_OF_OPTIONS) {
      kept.push(...words.slice(index));
      break;
    }
    if (word === OUT_OPTION) {
      const next = words[index + 1];
      if (next === undefined || (isOption(next) && next !== "-")) {
        out = { _tag: "Missing", word };
      } else {
        out = given(next);
        index += 1;
      }
    } else if (word.startsWith(`${OUT_OPTION}=`)) {
      const value = word.slice(OUT_OPTION.length + 1);
      out = value === "" ? { _tag: "Missing", word } : given(value);
    } else {
      kept.push(word);
    }
  }
  return { kept, out };
}

/** The text without the newline that ends it: a message line carries one text, not its line break. */
export const unterminated = (text: string): string =>
  text.endsWith("\n") ? text.slice(0, -1) : text;

/** What a `refused` line says of the call, besides its text and code. */
export interface Details {
  readonly source: RefusalSource;
  readonly path: ReadonlyArray<string>;
  readonly expected: string;
}

/** `dryRun` as `--dry-run`: an option as the call writes it. */
const optionAs = (field: string): string =>
  `--${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** Where a decode failed, as the call writes it: an option as written, a positional by its name
 *  (`names[index]`, else `arg0`), a stdin or env key by its field path, and then any nested key. */
export function pathOf(
  source: RefusalSource,
  segments: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>,
  names: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  const [first, ...rest] = segments.map((segment) =>
    String(typeof segment === "object" ? segment.key : segment),
  );
  if (first === undefined) return [];
  const head =
    source === "flags"
      ? optionAs(first)
      : source === "args"
        ? (names[Number(first)] ?? `arg${first}`)
        : first;
  return [head, ...rest];
}

/** The details of a decode failure, from the first issue Effect reports. `names` are the
 *  positionals' names, when the source is the arguments. */
export function detailsOf(
  source: RefusalSource,
  failure: unknown,
  names: ReadonlyArray<string> = [],
): Details {
  const issue: unknown =
    typeof failure === "object" && failure !== null
      ? Reflect.get(failure, "issue")
      : undefined;
  if (SchemaIssue.isIssue(issue)) {
    const first = SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues[0];
    if (first !== undefined) {
      return {
        source,
        path: pathOf(source, first.path ?? [], names),
        expected: first.message,
      };
    }
  }
  return { source, path: [], expected: "a value the contract accepts" };
}

/** The `refused` line for a call that ends with the program's refused code. */
export function refusedLine(
  details: Details,
  text: string,
  exit: ExitCode,
): string {
  return messages.refused({ ...details, text: unterminated(text), exit });
}

/** The `defect` line for a defect with this text. */
export function defectLine(text: string, exit: ExitCode): string {
  return messages.defect({ text: unterminated(text), exit });
}

const isWrittenList = (value: unknown): value is ReadonlyArray<Written> =>
  Array.isArray(value) && value.every(Schema.is(Written));

/** The line a failed run is written as under `--json`: an `error` line for a declared error, with
 *  its `written` field lifted out of `fields`, else a `defect` line. Fields JSON cannot encode (a
 *  bigint, a cycle) are a defect, with the program's defect code. */
export function outcomeLine(
  outcome: Outcome,
  defect: ExitCode,
): { readonly line: string; readonly code: ExitCode } {
  const declared = outcome.declared;
  if (declared === undefined) {
    return {
      line: defectLine(outcome.text, outcome.code),
      code: outcome.code,
    };
  }
  const { written, ...fields } = declared.fields;
  if (written !== undefined && !isWrittenList(written)) {
    return {
      line: defectLine(
        `defect: ${declared.tag} has a field written that is not an array of written-file records`,
        defect,
      ),
      code: defect,
    };
  }
  try {
    return {
      line: messages.error({
        error: declared.tag,
        exit: outcome.code,
        fields,
        written: written ?? [],
      }),
      code: outcome.code,
    };
  } catch (cause) {
    return {
      line: defectLine(
        `defect: ${declared.tag} has fields JSON cannot encode: ${cause instanceof Error ? cause.message : String(cause)}`,
        defect,
      ),
      code: defect,
    };
  }
}

/** The lines `notes` says, one `note` line each; nothing for an empty text. */
export function noteLines(notes: string): string {
  if (notes === "") return "";
  return unterminated(notes)
    .split("\n")
    .map((text) => messages.note(text))
    .join("");
}
