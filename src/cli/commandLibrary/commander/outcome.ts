import { Cause, Option } from "effect";
import type { Command, ExitCode, Program } from "../contract/index.js";

/** What the runner writes to `err` and the code it ends with. */
export interface Outcome {
  readonly text: string;
  readonly code: ExitCode;
  /** The declared error that ended the run: its tag and its own fields. Absent for a defect. */
  readonly declared?: {
    readonly tag: string;
    readonly fields: Readonly<Record<string, unknown>>;
  };
}

const line = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`);

function tagOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const tag: unknown = Reflect.get(error, "_tag");
  return typeof tag === "string" ? tag : undefined;
}

/** The error's own enumerable fields, without its tag. */
function fieldsOf(error: object): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(error).filter(([key]) => key !== "_tag"));
}

/** A value as one line of text, the way Effect 4's `Formatter.format` writes it: compact JSON,
 *  a bigint as `1n`, a cycle as `[Circular]`, and never a throw. Effect 3's `Inspectable.format`
 *  indents and throws on a bigint, so the port writes its own. */
function formatted(value: unknown): string {
  const seen = new WeakSet<object>();
  const go = (each: unknown): string => {
    if (typeof each === "bigint") return `${each}n`;
    if (typeof each === "string") return JSON.stringify(each);
    if (typeof each === "number" || typeof each === "boolean") return String(each);
    if (each === null) return "null";
    if (each === undefined) return "undefined";
    if (typeof each === "symbol") return each.toString();
    if (typeof each === "function") return `[Function${each.name === "" ? "" : ` ${each.name}`}]`;
    if (typeof each !== "object") return String(each);
    if (seen.has(each)) return "[Circular]";
    seen.add(each);
    const shown = Array.isArray(each)
      ? `[${each.map(go).join(",")}]`
      : `{${Object.entries(each)
          .map(([key, inner]) => `${JSON.stringify(key)}:${go(inner)}`)
          .join(",")}}`;
    seen.delete(each);
    return shown;
  };
  return go(value);
}

/** A defect's description, for `err`. */
export function defectText(why: string): string {
  return line(`defect: ${why}`);
}

/** The declared error that ended a failed `run`: its tag, its fields and its code, when the
 *  command maps the tag. Read with `Cause.findErrorOption`, the first typed error. */
export function declaredOf(
  command: Command<unknown>,
  cause: Cause.Cause<unknown>,
): { readonly error: object; readonly tag: string; readonly code: ExitCode } | undefined {
  const found = Cause.findErrorOption(cause);
  if (Option.isNone(found)) return undefined;
  const error = found.value;
  const tag = tagOf(error);
  const exits: Readonly<Record<string, ExitCode>> = command.exits;
  if (tag === undefined || typeof error !== "object" || error === null) return undefined;
  const code = exits[tag];
  if (!Object.hasOwn(exits, tag) || code === undefined) return undefined;
  return { error, tag, code };
}

/** The outcome of a failed `run`: a declared error answers its code, anything else the defect code. */
export function outcomeOf(
  program: Program<unknown>,
  command: Command<unknown>,
  cause: Cause.Cause<unknown>,
): Outcome {
  const declared = declaredOf(command, cause);
  if (declared !== undefined) {
    const fields = fieldsOf(declared.error);
    return {
      // `formatted` never throws: a bigint or a circular field is rendered, and the code stands.
      text: line(`${declared.tag} ${formatted(fields)}`),
      code: declared.code,
      declared: { tag: declared.tag, fields },
    };
  }
  return { text: defectText(Cause.pretty(cause)), code: program.exits.defect };
}
