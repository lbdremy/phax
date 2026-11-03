import type { Written } from "./written.ts";

/** The dialect every schema of the catalogue is written in. */
export const DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** A JSON Schema, as the catalogue carries it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** The encoded form of an output as stdout carries it: two-space indented, a newline after, the
 *  top-level `$schema` key first when there is one. The one place that lays it out. */
export function encodedText(encoded: unknown): string {
  const first =
    typeof encoded === "object" &&
    encoded !== null &&
    !Array.isArray(encoded) &&
    Object.hasOwn(encoded, "$schema")
      ? { $schema: Reflect.get(encoded, "$schema"), ...encoded }
      : encoded;
  return `${JSON.stringify(first, null, 2) ?? ""}\n`;
}

/** Where a refusal was found. `command` is a call that names no command, or a word the runner
 *  answers alone. */
export type RefusalSource = "args" | "flags" | "env" | "stdin" | "command";

/** One compact JSON object and its newline: a message line of stderr under `--json`. */
const compact = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** The five message lines of `--json`, one compact JSON object each, the keys in this order. None
 *  carries a `$schema`: their shapes are published once, under `messages` in the catalogue. */
export const messages = {
  /** A note for the person reading, beside the output. */
  note: (text: string): string => compact({ kind: "note", text }),
  /** A file the command wrote. */
  written: (record: Written): string =>
    compact({
      kind: "written",
      path: record.path,
      format: record.format,
      digest: record.digest,
    }),
  /** A declared error: its tag, its code, its fields, and the files it wrote before failing. */
  error: (line: {
    readonly error: string;
    readonly exit: number;
    readonly fields: Readonly<Record<string, unknown>>;
    readonly written: ReadonlyArray<Written>;
  }): string =>
    compact({
      kind: "error",
      error: line.error,
      exit: line.exit,
      fields: line.fields,
      written: line.written.map((record) => ({
        path: record.path,
        format: record.format,
        digest: record.digest,
      })),
    }),
  /** A call the runner would not run. `text` is what the text form writes, without its newline. */
  refused: (line: {
    readonly source: RefusalSource;
    readonly path: ReadonlyArray<string>;
    readonly expected: string;
    readonly text: string;
    readonly exit: number;
  }): string =>
    compact({
      kind: "refused",
      source: line.source,
      path: line.path,
      expected: line.expected,
      text: line.text,
      exit: line.exit,
    }),
  /** What no command declared: a bug. `text` is what the text form writes, without its newline. */
  defect: (line: { readonly text: string; readonly exit: number }): string =>
    compact({ kind: "defect", text: line.text, exit: line.exit }),
} as const;

const object = (
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  $schema: DIALECT,
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const kind = (name: string) => ({ const: name });
const string = { type: "string" } as const;
const integer = { type: "integer" } as const;
const record = {
  type: "object",
  properties: {
    path: string,
    format: { type: ["string", "null"] },
    digest: string,
  },
  required: ["path", "format", "digest"],
  additionalProperties: false,
} as const;

/** The shapes of the five message lines, by kind, as JSON Schema 2020-12: fixed, and the same in
 *  both command libraries. */
export const messageSchemas: Readonly<Record<string, JsonSchema>> = {
  note: object({ kind: kind("note"), text: string }),
  written: object({
    kind: kind("written"),
    path: string,
    format: { type: ["string", "null"] },
    digest: string,
  }),
  error: object({
    kind: kind("error"),
    error: string,
    exit: integer,
    fields: { type: "object" },
    written: { type: "array", items: record },
  }),
  refused: object({
    kind: kind("refused"),
    source: { enum: ["args", "flags", "env", "stdin", "command"] },
    path: { type: "array", items: string },
    expected: string,
    text: string,
    exit: integer,
  }),
  defect: object({ kind: kind("defect"), text: string, exit: integer }),
};
